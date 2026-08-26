import { randomUUID } from "node:crypto"
import { spawn } from "node:child_process"
import { constants, rmSync } from "node:fs"
import { access, mkdtemp, open, readFile, rm, stat } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import { basename, isAbsolute, join, resolve } from "node:path"
import { z } from "zod"
import defineTool from "../../define-tool"
import docs from "./docs.md?raw"

const inlineOutputLimit = 16 * 1_024
const maximumReadSize = 64 * 1_024

const input = z.discriminatedUnion("action", [
    z.object({ action: z.literal("inspect") }).strict(),
    z.object({
        action: z.literal("run"),
        command: z.string().trim().min(1).max(100_000),
        directory: z.string().trim().min(1).max(4_096).optional()
            .describe("Working directory. Defaults to the user's home directory."),
        shell: z.string().trim().min(1).max(4_096).optional()
            .describe("Available shell name or absolute path returned by inspect.")
    }).strict(),
    z.object({
        action: z.literal("read"),
        output: z.uuid().describe("Temporary output identifier returned by run."),
        offset: z.number().int().nonnegative().optional().describe("Byte offset. Defaults to 0."),
        limit: z.number().int().positive().max(maximumReadSize).optional()
            .describe(`Maximum bytes to read. Defaults to ${inlineOutputLimit}.`)
    }).strict()
])

/** Executes bounded, non-interactive shell operations without retaining a session. */
const shell = defineTool({
    order: 11,
    docs,
    input,
    name: "shell",
    description: "Inspect available shells, run a command, and read retained large command output.",
    async execute(request, context) {

        if (request.action === "inspect") return inspectShells()

        if (request.action === "read") {
            return readOutput(request.output, request.offset ?? 0, request.limit ?? inlineOutputLimit)
        }

        const inspected = await inspectShells()
        const executable = selectShell(request.shell, inspected)
        const directory = resolveDirectory(request.directory)
        const status = await stat(directory)

        if (!status.isDirectory()) throw new Error(`Shell working directory is not a directory: ${directory}`)

        const output = randomUUID()
        const path = join(await outputDirectory(), `${output}.log`)
        const file = await open(path, "wx", 0o600)

        let result: Awaited<ReturnType<typeof run>>

        try {
            result = await run(executable, request.command, directory, file.fd, context.invocation.signal)
        } catch (cause) {
            await file.close().catch(() => undefined)
            await rm(path, { force: true }).catch(() => undefined)
            throw cause
        }

        await file.close()

        const size = (await stat(path)).size
        const common = Object.freeze({
            command: request.command,
            directory,
            shell: executable,
            exitCode: result.exitCode,
            signal: result.signal
        })

        if (size <= inlineOutputLimit) {
            const content = await readFile(path, "utf8")

            await rm(path, { force: true })

            return Object.freeze({
                ...common,
                output: Object.freeze({ type: "inline", bytes: size, content })
            })
        }

        const preview = await readOutput(output, 0, 2_048)

        return Object.freeze({
            ...common,
            output: Object.freeze({
                type: "temporary",
                id: output,
                bytes: size,
                preview: preview.content
            })
        })
    }
})

export default shell

type ShellInspection = Readonly<{
    default: string
    directory: string
    available: readonly Readonly<{ name: string, path: string, default: boolean }>[]
}>

async function inspectShells(): Promise<ShellInspection> {

    const configured = process.env.SHELL?.trim()
    const candidates = new Set<string>()

    if (configured) candidates.add(configured)

    try {
        const declared = await readFile("/etc/shells", "utf8")

        for (const line of declared.split(/\r?\n/u)) {
            const path = line.trim()

            if (path && !path.startsWith("#") && isAbsolute(path)) candidates.add(path)
        }
    } catch {
        // Platforms without /etc/shells still expose their configured shell below.
    }

    candidates.add("/bin/sh")

    const available: string[] = []

    for (const candidate of candidates) {
        try {
            await access(candidate, constants.X_OK)
            available.push(resolve(candidate))
        } catch {
            // Ignore configured entries that are not executable on this host.
        }
    }

    if (!available.length) throw new Error("No executable shell is available")

    const defaultShell = configured && available.includes(resolve(configured))
        ? resolve(configured)
        : available[0]!

    return Object.freeze({
        default: defaultShell,
        directory: homedir(),
        available: Object.freeze(available.map(path => Object.freeze({
            name: basename(path),
            path,
            default: path === defaultShell
        })))
    })
}

function selectShell(requested: string | undefined, inspected: ShellInspection) {

    if (!requested) return inspected.default

    const found = inspected.available.find(candidate => (
        candidate.path === requested || candidate.name === requested
    ))

    if (!found) throw new Error(`Unknown or unavailable shell "${requested}"`)

    return found.path
}

function resolveDirectory(value = "~") {

    if (value === "~") return homedir()
    if (value.startsWith("~/")) return resolve(homedir(), value.slice(2))

    return isAbsolute(value) ? resolve(value) : resolve(homedir(), value)
}

async function run(shell: string, command: string, directory: string, output: number, signal: AbortSignal) {

    signal.throwIfAborted()

    const detached = process.platform !== "win32"
    const child = spawn(shell, ["-c", command], {
        cwd: directory,
        detached,
        stdio: ["ignore", output, output]
    })

    return new Promise<Readonly<{ exitCode: number | null, signal: NodeJS.Signals | null }>>((resolve, reject) => {
        let aborted = false
        let escalation: NodeJS.Timeout | undefined

        const terminate = () => {
            aborted = true

            terminateProcess(child.pid, child, detached, "SIGTERM")
            escalation = setTimeout(() => terminateProcess(child.pid, child, detached, "SIGKILL"), 1_000)
            escalation.unref()
        }

        const finish = () => {
            signal.removeEventListener("abort", terminate)
            if (escalation) clearTimeout(escalation)
        }

        signal.addEventListener("abort", terminate, { once: true })

        if (signal.aborted) terminate()

        child.once("error", error => {
            finish()
            reject(error)
        })

        child.once("close", (exitCode, childSignal) => {
            finish()

            if (aborted) reject(signal.reason ?? new Error("Shell command cancelled"))
            else resolve(Object.freeze({ exitCode, signal: childSignal }))
        })
    })
}

function terminateProcess(
    pid: number | undefined,
    child: ReturnType<typeof spawn>,
    detached: boolean,
    signal: NodeJS.Signals
) {

    try {
        if (detached && pid !== undefined) process.kill(-pid, signal)
        else child.kill(signal)
    } catch {
        // The command may already have exited between the signal and cleanup.
    }
}

async function readOutput(output: string, offset: number, limit: number) {

    const path = join(await outputDirectory(), `${output}.log`)
    const file = await open(path, "r").catch(cause => {
        const error = cause as NodeJS.ErrnoException

        if (error.code === "ENOENT") throw new Error(`Unknown or expired shell output "${output}"`)

        throw cause
    })

    try {
        const size = (await file.stat()).size

        if (offset > size) throw new Error(`Shell output offset ${offset} exceeds its ${size}-byte size`)

        const buffer = Buffer.alloc(Math.min(limit, size - offset))
        const { bytesRead } = await file.read(buffer, 0, buffer.length, offset)
        const next = offset + bytesRead

        return Object.freeze({
            output,
            offset,
            bytes: bytesRead,
            content: buffer.subarray(0, bytesRead).toString("utf8"),
            next: next < size ? next : null,
            size
        })
    } finally {
        await file.close()
    }
}

let directoryPromise: Promise<string> | undefined

function outputDirectory() {

    directoryPromise ??= mkdtemp(join(tmpdir(), "lemo-shell-")).then(directory => {
        process.once("exit", () => rmSync(directory, { recursive: true, force: true }))

        return directory
    })

    return directoryPromise
}
