import { host, type Process } from "@phreshos/server"
import { z } from "zod"
import type Tool from "../../tool"
import waitEvent from "../../wait-event"
import docs from "./docs.md?raw"

const processEvent = z.enum(["endpointStart", "endpointStop", "create", "exit"])

const value = z.union([z.number().finite(), z.string().trim().min(1)])

const client = z.object({
    title: z.string().optional(),
    size: z.object({ width: value, height: value }).strict().optional(),
    position: z.object({ x: value, y: value }).strict().optional(),
    layer: z.enum(["window", "under", "over"]).optional(),
    location: z.string().optional(),
    minimize: z.boolean().optional()
}).strict()

const launch = z.object({
    name: z.string().trim().min(1).optional(),
    server: z.boolean().optional(),
    client: z.union([z.boolean(), client]).optional(),
    options: z.record(z.string(), z.string()).optional()
}).strict()

const input = z.discriminatedUnion("action", [
    z.object({
        action: z.literal("list"),
        program: z.string().trim().min(1).optional()
    }).strict(),
    z.object({
        action: z.literal("inspect"),
        process: z.string().trim().min(1),
        program: z.string().trim().min(1).optional()
    }).strict(),
    z.object({
        action: z.literal("create"),
        program: z.string().trim().min(1),
        launch: launch.optional()
    }).strict(),
    z.object({
        action: z.literal("findOrCreate"),
        program: z.string().trim().min(1),
        launch: launch.extend({ name: z.string().trim().min(1) })
    }).strict(),
    z.object({
        action: z.literal("exit"),
        process: z.string().trim().min(1)
    }).strict(),
    z.object({
        action: z.literal("wait"),
        event: processEvent,
        process: z.string().trim().min(1).optional(),
        program: z.string().trim().min(1).optional(),
        timeout: z.number().int().positive().optional()
    }).strict()
]).refine(request => (
    request.action !== "wait"
    || request.process === undefined
    || request.event !== "create"
), { message: "An individual Process does not emit create" })

const launchParameters = Object.freeze({
    type: "object",
    properties: Object.freeze({
        name: Object.freeze({ type: "string" }),
        server: Object.freeze({ type: "boolean" }),
        client: Object.freeze({
            oneOf: Object.freeze([
                Object.freeze({ type: "boolean" }),
                Object.freeze({
                    type: "object",
                    properties: Object.freeze({
                        title: Object.freeze({ type: "string" }),
                        size: Object.freeze({
                            type: "object",
                            required: Object.freeze(["width", "height"]),
                            properties: Object.freeze({
                                width: Object.freeze({ type: Object.freeze(["number", "string"]) }),
                                height: Object.freeze({ type: Object.freeze(["number", "string"]) })
                            }),
                            additionalProperties: false
                        }),
                        position: Object.freeze({
                            type: "object",
                            required: Object.freeze(["x", "y"]),
                            properties: Object.freeze({
                                x: Object.freeze({ type: Object.freeze(["number", "string"]) }),
                                y: Object.freeze({ type: Object.freeze(["number", "string"]) })
                            }),
                            additionalProperties: false
                        }),
                        layer: Object.freeze({ type: "string", enum: Object.freeze(["window", "under", "over"]) }),
                        location: Object.freeze({ type: "string" }),
                        minimize: Object.freeze({ type: "boolean" })
                    }),
                    additionalProperties: false
                })
            ])
        }),
        options: Object.freeze({ type: "object", additionalProperties: Object.freeze({ type: "string" }) })
    }),
    additionalProperties: false
})

/** Reads and controls live Processes through their authoritative Program owners. */
const processes: Tool = {
    order: 6,
    docs,
    definition: Object.freeze({
        name: "processes",
        description: "List, inspect, create, find or create, and exit PhreshOS Processes.",
        parameters: Object.freeze({
            oneOf: Object.freeze([
                variant(["action"], {
                    action: Object.freeze({ const: "list" }),
                    program: Object.freeze({ type: "string" })
                }),
                variant(["action", "process"], {
                    action: Object.freeze({ const: "inspect" }),
                    process: Object.freeze({ type: "string" }),
                    program: Object.freeze({ type: "string" })
                }),
                variant(["action", "program"], {
                    action: Object.freeze({ const: "create" }),
                    program: Object.freeze({ type: "string" }),
                    launch: launchParameters
                }),
                variant(["action", "program", "launch"], {
                    action: Object.freeze({ const: "findOrCreate" }),
                    program: Object.freeze({ type: "string" }),
                    launch: Object.freeze({
                        ...launchParameters,
                        required: Object.freeze(["name"])
                    })
                }),
                variant(["action", "process"], {
                    action: Object.freeze({ const: "exit" }),
                    process: Object.freeze({ type: "string" })
                }),
                variant(["action", "event"], {
                    action: Object.freeze({ const: "wait" }),
                    event: Object.freeze({
                        type: "string",
                        enum: Object.freeze(["endpointStart", "endpointStop", "create", "exit"])
                    }),
                    process: Object.freeze({
                        type: "string",
                        description: "When supplied, wait on one Process; create is not valid."
                    }),
                    program: Object.freeze({
                        type: "string",
                        description: "With process, scopes name resolution; without process, waits on this Program's Process registry."
                    }),
                    timeout: Object.freeze({ type: "integer", minimum: 1 })
                })
            ])
        })
    }),
    async execute(value, context) {

        const request = input.parse(value)

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
                    : await waitEvent(host.process, request.event, context.invocation.signal, request.timeout)

            return Object.freeze({
                scope: scoped ? "process" : request.program ? "program" : "host",
                ...(scoped ? { process: scoped.identity } : {}),
                ...(request.program ? { program: request.program } : {}),
                event: request.event,
                payload: await processEventPayload(request.event, payload, scoped)
            })
        }

        if (request.action === "list") {

            const found = request.program
                ? await (await requiredProgram(request.program)).process.list()
                : await host.process.list()

            return await Promise.all(found.map(snapshot))
        }

        if (request.action === "inspect") {

            return snapshot(await requiredProcess(request.process, request.program))
        }

        if (request.action === "exit") {

            const process = await requiredProcess(request.process)

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
}

export default processes

async function requiredProgram(identity: string) {

    const program = await host.program.find(identity)

    if (!program) throw new Error(`Unknown Program "${identity}"`)

    return program
}

async function requiredProcess(identityOrName: string, programIdentity?: string) {

    const process = programIdentity
        ? await (await requiredProgram(programIdentity)).process.find(identityOrName)
        : await host.process.find(identityOrName)

    if (!process) {

        const scope = programIdentity ? ` in Program "${programIdentity}"` : ""

        throw new Error(`Unknown Process "${identityOrName}"${scope}`)
    }

    return process
}

async function snapshot(process: Process) {

    const program = await process.program()

    const [server, client] = await Promise.all([
        process.server.exists(),
        process.client.exists()
    ])

    return Object.freeze({
        identity: process.identity,
        name: process.name,
        program: program.identity,
        startedAt: process.startedAt.toISOString(),
        server: Object.freeze({ declared: program.server !== null, running: server }),
        client: Object.freeze({ declared: program.client !== null, running: client })
    })
}

async function remember(
    context: Parameters<Tool["execute"]>[1],
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

function variant(required: readonly string[], properties: Readonly<Record<string, unknown>>) {

    return Object.freeze({
        type: "object",
        required: Object.freeze(required),
        properties: Object.freeze(properties),
        additionalProperties: false
    })
}

async function processEventPayload(
    event: "endpointStart" | "endpointStop" | "create" | "exit",
    value: unknown,
    scoped: Process | null
) {

    if (event === "create") return snapshot(value as Process)

    if (event === "endpointStart" || event === "endpointStop") {

        const endpoint = value as Process["server"] | Process["client"]
        const process = await endpoint.process()

        return Object.freeze({
            process: process.identity,
            endpoint: endpoint === process.server ? "server" : "client"
        })
    }

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
