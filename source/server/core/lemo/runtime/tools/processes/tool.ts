import { system, type Process } from "@phreshos/server"
import { z } from "zod"
import defineTool from "../../define-tool"
import type { ToolContext } from "../../tool"
import waitEvent from "../../wait-event"
import docs from "./docs.md?raw"

const identity = z.string().trim().min(1)
const value = z.union([z.number(), z.string().trim().min(1)])
    .describe("Absolute pixels as a number, or a workspace-relative expression such as 50% or 1/2.")
const position = z.object({ x: value, y: value }).strict()
const size = z.object({ width: value, height: value }).strict()
const serverLaunch = z.object({ service: z.boolean().optional() }).strict()
const clientLaunch = z.object({
    service: z.boolean().optional(),
    title: z.string().optional(),
    size: size.optional(),
    position: position.optional(),
    layer: z.enum(["window", "under", "over"]).optional(),
    location: z.string().optional(),
    minimize: z.boolean().optional()
}).strict()
const launch = z.object({
    name: identity.optional(),
    server: z.union([z.boolean(), serverLaunch]).optional(),
    client: z.union([z.boolean(), clientLaunch]).optional(),
    options: z.record(z.string(), z.string()).optional()
}).strict()
const namedLaunch = launch.extend({ name: identity })

const input = z.discriminatedUnion("action", [
    z.object({
        action: z.literal("list"),
        program: identity.optional(),
        search: identity.optional(),
        limit: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().nonnegative().optional()
    }).strict(),
    z.object({ action: z.literal("inspect"), process: identity, program: identity.optional() }).strict(),
    z.object({ action: z.literal("exit"), process: identity, program: identity.optional() }).strict(),
    z.object({ action: z.literal("create"), program: identity, launch: launch.optional() }).strict(),
    z.object({ action: z.literal("findOrCreate"), program: identity, launch: namedLaunch }).strict(),
    z.object({
        action: z.literal("wait"),
        event: z.enum(["create", "exit"]),
        process: identity.optional(),
        program: identity.optional(),
        timeout: z.number().int().positive().optional()
    }).strict()
]).superRefine((request, context) => {
    if (request.action !== "wait" || !request.process || request.event !== "create") return

    context.addIssue({ code: "custom", message: "An individual Process does not emit create" })
})

/** Reads and controls live Processes through their authoritative Program owners. */
const processes = defineTool({
    order: 6,
    docs,
    input,
    name: "processes",
    description: "Discover and control live executions of PhreshOS Programs.",
    async execute(request, context) {

        if (request.action === "wait") {

            const scoped = request.process
                ? await requiredProcess(request.process, request.program)
                : null
            const payload = scoped
                ? await waitEvent(scoped, request.event, context.invocation.signal, request.timeout)
                : request.program
                    ? await waitEvent(
                        (await requiredProgram(request.program)).process,
                        request.event,
                        context.invocation.signal,
                        request.timeout
                    )
                    : await waitEvent(system.process, request.event, context.invocation.signal, request.timeout)

            return Object.freeze({
                scope: scoped ? "process" : request.program ? "program" : "system",
                ...(scoped ? { process: scoped.identity } : {}),
                ...(request.program ? { program: request.program } : {}),
                event: request.event,
                payload: await processEventPayload(request.event, payload, scoped)
            })
        }

        if (request.action === "list") {

            const found = request.program
                ? await (await requiredProgram(request.program)).process.list()
                : await system.process.list()

            const query = request.search?.toLocaleLowerCase()
            const matching = found.filter(process => (
                !query || [process.identity, process.name]
                    .some(value => value?.toLocaleLowerCase().includes(query))
            ))
            const offset = request.offset ?? 0
            const selected = matching
                .sort((left, right) => right.startedAt.getTime() - left.startedAt.getTime())
                .slice(offset, offset + (request.limit ?? 30))

            return Object.freeze({
                data: Object.freeze(await Promise.all(selected.map(snapshot))),
                total: matching.length,
                truncated: offset + selected.length < matching.length
            })
        }

        if (request.action === "inspect") {

            return snapshot(await requiredProcess(request.process, request.program))
        }

        if (request.action === "exit") {

            const process = await requiredProcess(request.process, request.program)

            const before = await snapshot(process)

            await process.exit()

            await remember(context, before, "exited", "processes.exit")

            return Object.freeze({ ...before, exited: true })
        }

        const program = await requiredProgram(request.program)

        const process = request.action === "create"
            ? await program.process.create(request.launch)
            : await program.process.findOrCreate(request.launch)

        const result = await snapshot(process)

        await remember(
            context,
            result,
            request.action === "create" ? "created" : "resolved",
            `processes.${request.action}`
        )

        return result
    }
})

export default processes

async function requiredProgram(identity: string) {

    const program = await system.program.find(identity)

    if (!program) throw new Error(`Unknown Program "${identity}"`)

    return program
}

async function requiredProcess(identityOrName: string, programIdentity?: string) {

    const process = programIdentity
        ? await (await requiredProgram(programIdentity)).process.find(identityOrName)
        : await system.process.find(identityOrName)

    if (!process) {

        const scope = programIdentity ? ` in Program "${programIdentity}"` : ""

        throw new Error(`Unknown Process "${identityOrName}"${scope}`)
    }

    return process
}

async function snapshot(process: Process) {

    const program = await process.program()

    const [server, client, serverService, clientService] = await Promise.all([
        process.server.exists(),
        process.client.exists(),
        process.server.isService(),
        process.client.isService()
    ])

    return Object.freeze({
        identity: process.identity,
        name: process.name,
        program: program.identity,
        startedAt: process.startedAt.toISOString(),
        server: Object.freeze({ declared: program.server !== null, running: server, service: serverService }),
        client: Object.freeze({ declared: program.client !== null, running: client, service: clientService })
    })
}

async function remember(
    context: ToolContext,
    process: Awaited<ReturnType<typeof snapshot>>,
    action: "created" | "resolved" | "exited",
    method: string
) {

    const name = process.name ? ` named "${process.name}"` : ""

    await context.memory.record({
        content: `Process "${process.identity}"${name} for Program "${process.program}" was ${action}.`,
        source: `phreshos:process:${process.identity}`,
        method
    })
}

async function processEventPayload(
    event: "create" | "exit",
    value: unknown,
    scoped: Process | null
) {

    if (event === "create") return snapshot(value as Process)

    const payload = value as {
        process?: Process
        status: "exited" | "signaled"
        code: number | null
        signal: string | null
    }

    return Object.freeze({
        process: payload.process?.identity ?? scoped?.identity ?? null,
        status: payload.status,
        code: payload.code,
        signal: payload.signal
    })
}
