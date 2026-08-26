import { createHash, randomUUID } from "node:crypto"
import {
    chmod,
    link,
    lstat,
    mkdir,
    opendir,
    readFile,
    rename,
    rm,
    rmdir,
    unlink,
    writeFile
} from "node:fs/promises"
import { createReadStream, createWriteStream } from "node:fs"
import type { Dirent } from "node:fs"
import { homedir } from "node:os"
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path"
import { Transform } from "node:stream"
import { pipeline } from "node:stream/promises"

export const maximumDirectoryPage = 200
export const maximumReadLines = 500
export const maximumReadCharacters = 100_000
export const maximumEditableBytes = 8 * 1024 * 1024

export type TextFileChange = Readonly<{
    oldText: string
    newText: string
    occurrence?: number
}>

type EntryKind = "file" | "directory" | "symbolic-link" | "other"

/**
 * Internal UTF-8 filesystem layer. It deliberately does not expose PhreshOS
 * Storage: Files is a Lemo capability with its own bounded contract.
 */
export default class TextFiles {
    private readonly mutations = new Map<string, Promise<void>>()

    public path(value = "~") {

        if (value === "~") return homedir()
        if (value.startsWith("~/")) return resolve(homedir(), value.slice(2))

        return isAbsolute(value) ? resolve(value) : resolve(homedir(), value)
    }

    public async list(path: string, cursor = 0, limit = 50, signal?: AbortSignal) {

        const directory = this.path(path)
        const handle = await opendir(directory)
        const entries: Array<Readonly<{
            name: string
            path: string
            kind: EntryKind
        }>> = []
        let seen = 0
        let hasMore = false

        try {
            for await (const entry of handle) {
                assertActive(signal)

                if (seen++ < cursor) continue
                if (entries.length === limit) {
                    hasMore = true
                    break
                }

                entries.push(Object.freeze({
                    name: entry.name,
                    path: join(directory, entry.name),
                    kind: directoryKind(entry)
                }))
            }
        } finally {
            await handle.close().catch(() => undefined)
        }

        return Object.freeze({
            path: directory,
            entries: Object.freeze(entries),
            next: hasMore ? cursor + entries.length : null
        })
    }

    public async inspect(path: string) {

        const absolute = this.path(path)
        const status = await lstat(absolute)

        return Object.freeze({
            path: absolute,
            name: basename(absolute),
            kind: statKind(status),
            size: status.size,
            modifiedAt: status.mtime.toISOString()
        })
    }

    public async read(path: string, startLine = 1, lineCount = 200) {

        const absolute = this.path(path)
        const snapshot = await readTextSnapshot(absolute)
        const page = textPage(snapshot.content, startLine, lineCount)

        if (page.content.length > maximumReadCharacters) {
            throw new Error(`The selected line range exceeds the ${maximumReadCharacters}-character response limit`)
        }

        return Object.freeze({
            path: absolute,
            revision: snapshot.revision,
            size: snapshot.size,
            modifiedAt: snapshot.modifiedAt,
            startLine: page.startLine,
            endLine: page.endLine,
            content: page.content,
            nextLine: page.nextLine,
            totalLines: page.totalLines
        })
    }

    public async create(path: string, content: string, parents = true) {

        const absolute = this.path(path)

        return this.mutate(absolute, async () => {
            if (parents) await mkdir(dirname(absolute), { recursive: true })

            await createAtomic(absolute, content)

            return readTextMetadata(absolute)
        })
    }

    public async write(path: string, revision: string, content: string) {

        const absolute = this.path(path)

        return this.mutate(absolute, async () => {
            const current = await readTextSnapshot(absolute)

            assertRevision(absolute, revision, current.revision)
            await replaceAtomic(absolute, content, current.mode)

            return readTextMetadata(absolute)
        })
    }

    public async edit(path: string, revision: string, changes: readonly TextFileChange[]) {

        const absolute = this.path(path)

        return this.mutate(absolute, async () => {
            const current = await readTextSnapshot(absolute)

            assertRevision(absolute, revision, current.revision)

            let content = current.content

            for (const change of changes) content = replaceOccurrence(content, change)

            await replaceAtomic(absolute, content, current.mode)

            return readTextMetadata(absolute)
        })
    }

    public async directory(path: string) {

        const absolute = this.path(path)

        return this.mutate(absolute, async () => {
            await mkdir(absolute, { recursive: true })

            return this.inspect(absolute)
        })
    }

    public async delete(path: string, recursive = false) {

        const absolute = this.path(path)

        if (dirname(absolute) === absolute || absolute === homedir()) {
            throw new Error("The Files tool cannot delete a filesystem root or the user's home directory")
        }

        return this.mutate(absolute, async () => {
            const status = await lstat(absolute)
            const kind = statKind(status)

            if (status.isDirectory() && !status.isSymbolicLink()) {
                if (recursive) await rm(absolute, { recursive: true })
                else await rmdir(absolute)
            } else {
                await unlink(absolute)
            }

            return Object.freeze({ path: absolute, kind, recursive })
        })
    }

    public async copy(source: string, destination: string, parents = true, signal?: AbortSignal) {

        const from = this.path(source)
        const to = this.path(destination)
        const relation = relative(from, to)

        if (!relation || (!relation.startsWith("..") && !isAbsolute(relation))) {
            throw new Error("A copy destination cannot be the source or one of its descendants")
        }

        return this.mutate(to, async () => {
            assertActive(signal)
            await mustNotExist(to)

            if (parents) await mkdir(dirname(to), { recursive: true })

            const staging = join(dirname(to), `.${basename(to)}.lemo-${randomUUID()}`)
            const counts = { files: 0, directories: 0, bytes: 0 }

            try {
                const status = await lstat(from)

                if (status.isSymbolicLink()) throw new Error("Symbolic links cannot be copied by the Files tool")

                if (status.isFile()) {
                    await copyTextFile(from, staging, status.mode, counts, signal)
                    await link(staging, to)
                    await unlink(staging)
                } else if (status.isDirectory()) {
                    await copyTextDirectory(from, staging, counts, signal)
                    await rename(staging, to)
                } else {
                    throw new Error("Only UTF-8 files and directories can be copied")
                }
            } catch (cause) {
                await rm(staging, { recursive: true, force: true })
                throw cause
            }

            return Object.freeze({
                source: from,
                destination: to,
                files: counts.files,
                directories: counts.directories,
                bytes: counts.bytes
            })
        })
    }

    private async mutate<Result>(path: string, operation: () => Promise<Result>): Promise<Result> {

        const previous = this.mutations.get(path) ?? Promise.resolve()
        let release!: () => void
        const current = new Promise<void>(resolvePromise => { release = resolvePromise })

        this.mutations.set(path, current)
        await previous

        try {
            return await operation()
        } finally {
            release()

            if (this.mutations.get(path) === current) this.mutations.delete(path)
        }
    }
}

type TextSnapshot = Readonly<{
    content: string
    revision: string
    size: number
    modifiedAt: string
    mode: number
}>

async function readTextSnapshot(path: string): Promise<TextSnapshot> {

    const status = await lstat(path)

    if (!status.isFile() || status.isSymbolicLink()) throw new Error(`"${path}" is not a regular file`)
    if (status.size > maximumEditableBytes) {
        throw new Error(`"${path}" exceeds the ${maximumEditableBytes}-byte text editing limit`)
    }

    const bytes = await readFile(path)
    const content = decode(bytes, path)

    return Object.freeze({
        content,
        revision: revision(bytes),
        size: bytes.byteLength,
        modifiedAt: status.mtime.toISOString(),
        mode: status.mode
    })
}

async function readTextMetadata(path: string) {

    const snapshot = await readTextSnapshot(path)

    return Object.freeze({
        path,
        revision: snapshot.revision,
        size: snapshot.size,
        modifiedAt: snapshot.modifiedAt
    })
}

function decode(bytes: Uint8Array, path: string) {

    try {
        return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    } catch {
        throw new Error(`"${path}" is not valid UTF-8 text`)
    }
}

function revision(bytes: Uint8Array) {

    return `sha256:${createHash("sha256").update(bytes).digest("hex")}`
}

function textPage(content: string, requestedLine: number, count: number) {

    if (!content) {
        return Object.freeze({
            startLine: null,
            endLine: null,
            content: "",
            nextLine: null,
            totalLines: 0
        })
    }

    const lines: Array<Readonly<{ start: number, end: number }>> = []
    let start = 0

    for (let index = 0; index < content.length; index++) {
        if (content[index] !== "\n") continue

        lines.push(Object.freeze({
            start,
            end: index > start && content[index - 1] === "\r" ? index - 1 : index
        }))
        start = index + 1
    }

    if (start < content.length) lines.push(Object.freeze({ start, end: content.length }))

    const offset = Math.min(requestedLine - 1, lines.length)
    const selected = lines.slice(offset, offset + count)

    if (!selected.length) {
        return Object.freeze({
            startLine: null,
            endLine: null,
            content: "",
            nextLine: null,
            totalLines: lines.length
        })
    }

    const endLine = offset + selected.length

    return Object.freeze({
        startLine: offset + 1,
        endLine,
        content: content.slice(selected[0]!.start, selected.at(-1)!.end),
        nextLine: endLine < lines.length ? endLine + 1 : null,
        totalLines: lines.length
    })
}

function replaceOccurrence(content: string, change: TextFileChange) {

    const matches: number[] = []
    let cursor = 0

    while (cursor <= content.length) {
        const index = content.indexOf(change.oldText, cursor)

        if (index < 0) break

        matches.push(index)
        cursor = index + change.oldText.length
    }

    if (!matches.length) throw new Error("An edit anchor was not found in the current file")

    let selected: number

    if (change.occurrence !== undefined) {
        selected = matches[change.occurrence - 1] ?? -1
        if (selected < 0) throw new Error(`Edit anchor occurrence ${change.occurrence} does not exist`)
    } else {
        if (matches.length !== 1) throw new Error("An edit anchor is ambiguous; specify its occurrence")
        selected = matches[0]!
    }

    return content.slice(0, selected) + change.newText + content.slice(selected + change.oldText.length)
}

async function createAtomic(path: string, content: string) {

    await mustNotExist(path)

    const staging = join(dirname(path), `.${basename(path)}.lemo-${randomUUID()}`)

    try {
        await writeFile(staging, content, { encoding: "utf8", flag: "wx" })
        await link(staging, path)
    } finally {
        await rm(staging, { force: true })
    }
}

async function replaceAtomic(path: string, content: string, mode: number) {

    const staging = join(dirname(path), `.${basename(path)}.lemo-${randomUUID()}`)

    try {
        await writeFile(staging, content, { encoding: "utf8", flag: "wx", mode })
        await rename(staging, path)
    } finally {
        await rm(staging, { force: true })
    }
}

async function mustNotExist(path: string) {

    try {
        await lstat(path)
    } catch (cause) {
        if (isNodeError(cause) && cause.code === "ENOENT") return
        throw cause
    }

    throw new Error(`"${path}" already exists`)
}

function assertRevision(path: string, expected: string, actual: string) {

    if (expected !== actual) {
        throw new Error(`"${path}" changed after it was read; read it again before editing`)
    }
}

async function copyTextDirectory(
    source: string,
    destination: string,
    counts: { files: number, directories: number, bytes: number },
    signal?: AbortSignal
) {

    assertActive(signal)

    const status = await lstat(source)

    await mkdir(destination, { mode: status.mode })
    counts.directories++

    const directory = await opendir(source)

    try {
        for await (const entry of directory) {
            assertActive(signal)

            const from = join(source, entry.name)
            const to = join(destination, entry.name)

            if (entry.isSymbolicLink()) throw new Error(`Symbolic link "${from}" cannot be copied`)

            if (entry.isDirectory()) {
                await copyTextDirectory(from, to, counts, signal)
            } else if (entry.isFile()) {
                const file = await lstat(from)
                await copyTextFile(from, to, file.mode, counts, signal)
            } else {
                throw new Error(`Unsupported filesystem entry "${from}"`)
            }
        }
    } finally {
        await directory.close().catch(() => undefined)
    }

    await chmod(destination, status.mode)
}

async function copyTextFile(
    source: string,
    destination: string,
    mode: number,
    counts: { files: number, directories: number, bytes: number },
    signal?: AbortSignal
) {

    const decoder = new TextDecoder("utf-8", { fatal: true })
    const validator = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
            try {
                decoder.decode(chunk, { stream: true })
                counts.bytes += chunk.byteLength
                callback(null, chunk)
            } catch {
                callback(new Error(`"${source}" is not valid UTF-8 text`))
            }
        },
        flush(callback) {
            try {
                decoder.decode()
                callback()
            } catch {
                callback(new Error(`"${source}" is not valid UTF-8 text`))
            }
        }
    })

    await pipeline(
        createReadStream(source),
        validator,
        createWriteStream(destination, { flags: "wx", mode }),
        { signal }
    )

    counts.files++
}

function statKind(status: Awaited<ReturnType<typeof lstat>>): EntryKind {

    if (status.isFile()) return "file"
    if (status.isDirectory()) return "directory"
    if (status.isSymbolicLink()) return "symbolic-link"

    return "other"
}

function directoryKind(entry: Dirent): EntryKind {

    if (entry.isFile()) return "file"
    if (entry.isDirectory()) return "directory"
    if (entry.isSymbolicLink()) return "symbolic-link"

    return "other"
}

function assertActive(signal?: AbortSignal) {

    if (signal?.aborted) throw signal.reason ?? new Error("File operation cancelled")
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {

    return value instanceof Error && "code" in value
}
