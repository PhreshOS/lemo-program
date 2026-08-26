import { spawn } from "node:child_process"
import { constants } from "node:fs"
import { access, readFile, stat } from "node:fs/promises"
import { homedir } from "node:os"
import { basename, isAbsolute, resolve } from "node:path"
import { z } from "zod"
import { tokenSlice } from "../../../token-budget"
import defineTool from "../../define-tool"
import docs from "./docs.md?raw"

const inlineOutputLimit = 16 * 1_024
const modelOutputTokens = 2_048

const input = z.discriminatedUnion("action", [
    z.object({ action: z.literal("inspect") }).strict(),
    z.object({
        action: z.literal("run"),
        command: z.string().trim().min(1).max(100_000),
        directory: z.string().trim().min(1).max(4_096).optional()
            .describe("Working directory. Defaults to the user's home directory."),
        shell: z.string().trim().min(1).max(4_096).optional()
            .describe("Available shell name or absolute path returned by inspect.")
    }).strict()
])

/** Executes bounded, non-interactive shell operations without retaining a session. */
const shell = defineTool({
    order: 11,
    docs,
    input,
    name: "shell",
    description: "Inspect available shells and run an independent non-interactive command.",
    async execute(request, context) {

        if (request.action === "inspect") return inspectShells()

        const inspected = await inspectShells()
        const executable = selectShell(request.shell, inspected)
        const directory = resolveDirectory(request.directory)
        const status = await stat(directory)

        if (!status.isDirectory()) throw new Error(`Shell working directory is not a directory: ${directory}`)

        const result = await run(executable, request.command, directory, context.invocation.signal)
        const common = Object.freeze({
            command: request.command,
            directory,
            shell: executable,
            exitCode: result.exitCode,
            signal: result.signal
        })

        if (result.bytes <= inlineOutputLimit) {
            return Object.freeze({
                ...common,
                output: Object.freeze({ type: "inline", bytes: result.bytes, content: result.output })
            })
        }

        return Object.freeze({
            ...common,
            output: Object.freeze({
                type: "stored",
                bytes: result.bytes,
                content: result.output
            })
        })
    },
    modelOutput(output) {

        const value = record(output)
        const result = record(value?.output)

        if (result?.type !== "stored" || typeof result.content !== "string") return output

        const preview = tokenSlice(result.content, modelOutputTokens)

        return Object.freeze({
            ...value,
            output: Object.freeze({
                type: "stored",
                bytes: result.bytes,
                preview: preview.content,
                truncated: preview.next !== null,
                tokens: preview.total
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

async function run(shell: string, command: string, directory: string, signal: AbortSignal) {

    signal.throwIfAborted()

    const detached = process.platform !== "win32"
    const child = spawn(shell, ["-c", command], {
        cwd: directory,
        detached,
        stdio: ["ignore", "pipe", "pipe"]
    })

    return new Promise<Readonly<{
        exitCode: number | null
        signal: NodeJS.Signals | null
        output: string
        bytes: number
    }>>((resolve, reject) => {
        let aborted = false
        let escalation: NodeJS.Timeout | undefined
        const chunks: Buffer[] = []
        let bytes = 0

        const receive = (value: Buffer) => {
            chunks.push(value)
            bytes += value.length
        }

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

        child.stdout.on("data", receive)
        child.stderr.on("data", receive)

        if (signal.aborted) terminate()

        child.once("error", error => {
            finish()
            reject(error)
        })

        child.once("close", (exitCode, childSignal) => {
            finish()

            if (aborted) reject(signal.reason ?? new Error("Shell command cancelled"))
            else resolve(Object.freeze({
                exitCode,
                signal: childSignal,
                output: Buffer.concat(chunks, bytes).toString("utf8"),
                bytes
            }))
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

function record(value: unknown) {

    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null
}
