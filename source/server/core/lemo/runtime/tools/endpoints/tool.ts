import { system, type Process } from "@phreshos/server"
import { z } from "zod"
import defineTool from "../../define-tool"
import waitEvent from "../../wait-event"
import docs from "./docs.md?raw"

const identity = z.string().trim().min(1)
const coordinates = { process: identity, program: identity.optional() }
const endpoint = z.enum(["server", "client"])
const timeout = z.number().int().positive().optional()
const payload = z.union([
    z.record(z.string(), z.unknown()),
    z.array(z.unknown()),
    z.string(),
    z.number(),
    z.boolean(),
    z.null()
])
const serverLaunch = z.object({ service: z.boolean().optional() }).strict()
const value = z.union([z.number(), z.string().trim().min(1)])
    .describe("Absolute pixels as a number, or a workspace-relative expression such as 50% or 1/2.")
const clientLaunch = z.object({
    service: z.boolean().optional(),
    title: z.string().optional(),
    size: z.object({ width: value, height: value }).strict().optional(),
    position: z.object({ x: value, y: value }).strict().optional(),
    layer: z.enum(["window", "under", "over"]).optional(),
    location: z.string().optional(),
    minimize: z.boolean().optional()
}).strict()

const input = z.union([
    z.object({ action: z.literal("inspect"), ...coordinates, endpoint }).strict(),
    z.object({ action: z.literal("start"), ...coordinates, endpoint: z.literal("server"), launch: serverLaunch.optional() }).strict(),
    z.object({ action: z.literal("start"), ...coordinates, endpoint: z.literal("client"), launch: clientLaunch.optional() }).strict(),
    z.object({ action: z.literal("stop"), ...coordinates, endpoint }).strict(),
    z.object({ action: z.literal("waitReady"), ...coordinates, endpoint: z.literal("server"), timeout }).strict(),
    z.object({
        action: z.literal("waitLifecycle"),
        ...coordinates,
        endpoint,
        event: z.enum(["start", "stop"]),
        timeout
    }).strict(),
    z.object({
        action: z.literal("ask"),
        ...coordinates,
        endpoint: z.literal("server"),
        event: identity,
        payload: payload.optional(),
        timeout
    }).strict(),
    z.object({
        action: z.literal("publish"),
        ...coordinates,
        endpoint,
        event: identity,
        payload: payload.optional()
    }).strict(),
    z.object({ action: z.literal("wait"), ...coordinates, endpoint, event: identity, timeout }).strict()
])

/** Reads and controls individual Process Endpoints. */
const endpoints = defineTool({
    order: 8,
    docs,
    input,
    name: "endpoints",
    description: "Inspect, control, and communicate with Server and Client Endpoints of live Processes.",
    async execute(request, context) {

        const process = await requiredProcess(request.process, request.program)

        if (request.action === "wait") {

            await requireEndpoint(process, request.endpoint)

            const target = process[request.endpoint]

            if (!await target.exists()) throw new Error(`The ${request.endpoint} Endpoint is not running`)

            return Object.freeze({
                process: process.identity,
                endpoint: request.endpoint,
                event: request.event,
                payload: await waitEvent(target, request.event, context.invocation.signal, request.timeout)
            })
        }

        if (request.action === "ask") {

            await requireEndpoint(process, "server")

            const server = request.timeout === undefined
                ? process.server
                : process.server.timeout(request.timeout)

            return "payload" in request
                ? await server.ask(request.event, request.payload)
                : await server.ask(request.event)
        }

        if (request.action === "publish") {

            await requireEndpoint(process, request.endpoint)

            const target = process[request.endpoint]

            if (!await target.exists()) throw new Error(`The ${request.endpoint} Endpoint is not running`)

            if ("payload" in request) target.publish(request.event, request.payload)
            else target.publish(request.event)

            return Object.freeze({
                ...await snapshot(process, request.endpoint),
                event: request.event,
                published: true
            })
        }

        if (request.action === "waitReady") {

            await requireEndpoint(process, "server")

            await process.server.waitReady(request.timeout)

            return snapshot(process, "server")
        }

        if (request.action === "waitLifecycle") {

            await requireEndpoint(process, request.endpoint)

            return Object.freeze({
                process: process.identity,
                endpoint: request.endpoint,
                event: request.event,
                payload: await waitEvent(
                    process[request.endpoint].lifecycle,
                    request.event,
                    context.invocation.signal,
                    request.timeout
                )
            })
        }

        if (request.action === "inspect") return snapshot(process, request.endpoint)

        await requireEndpoint(process, request.endpoint)

        const target = process[request.endpoint]

        if (request.action === "start") {
            if (request.endpoint === "server") await process.server.start(request.launch)
            else await process.client.start(request.launch)
        } else await target.stop()

        const result = await snapshot(process, request.endpoint)

        await context.memory.record({
            content: `${endpointName(result)} was ${request.action === "start" ? "started" : "stopped"}.`,
            source: `phreshos:endpoint:${result.process}:${result.endpoint}`,
            method: `endpoints.${request.action}`
        })

        return result
    },
    modelOutput: endpointModelOutput
})

export default endpoints

/** Owns the bounded representation of Endpoint results used in Model context. */
export function endpointModelOutput(output: unknown): unknown {

    const compact = compactValue(output)
    const serialized = JSON.stringify(compact)

    if (serialized.length <= 24_000) return compact

    return Object.freeze({
        kind: "large-endpoint-result",
        originalCharacters: JSON.stringify(output).length,
        contextCharacters: serialized.length,
        preview: serialized.slice(0, 16_000),
        note: "The raw result remains in the Task database; this bounded preview is only for Model context."
    })
}

async function requiredProcess(identityOrName: string, programIdentity?: string) {

    if (!programIdentity) {

        const process = await system.process.find(identityOrName)

        if (process) return process

        throw new Error(`Unknown Process "${identityOrName}"`)
    }

    const program = await system.program.find(programIdentity)

    if (!program) throw new Error(`Unknown Program "${programIdentity}"`)

    const process = await program.process.find(identityOrName)

    if (!process) throw new Error(`Unknown Process "${identityOrName}" in Program "${programIdentity}"`)

    return process
}

async function requireEndpoint(process: Process, endpoint: "server" | "client") {

    const program = await process.program()

    if (!program[endpoint]) {

        throw new Error(`Program "${program.identity}" does not declare a ${endpoint} Endpoint`)
    }

}

async function snapshot(process: Process, endpoint: "server" | "client") {

    const program = await process.program()

    const declaration = program[endpoint]

    const [running, service] = await Promise.all([
        process[endpoint].exists(),
        process[endpoint].isService()
    ])

    return Object.freeze({
        process: process.identity,
        program: program.identity,
        endpoint,
        declared: declaration !== null,
        running,
        service
    })
}

function endpointName(value: Awaited<ReturnType<typeof snapshot>>) {

    return `The ${value.endpoint} Endpoint of Process "${value.process}" in Program "${value.program}"`
}

function compactValue(value: unknown, key = ""): unknown {

    if (typeof value === "string") {

        if (binaryKey(key) && value.length > 256) {

            return Object.freeze({
                kind: "binary",
                characters: value.length,
                note: "Binary content is retained in the database but omitted from text Model context."
            })
        }

        if (value.length > 8_000) return `${value.slice(0, 6_000)}\n[${value.length - 6_000} characters omitted]`

        return value
    }

    if (Array.isArray(value)) {

        if (value.length <= 40) return value.map(item => compactValue(item))

        return Object.freeze({
            items: value.slice(0, 40).map(item => compactValue(item)),
            omittedItems: value.length - 40
        })
    }

    if (typeof value !== "object" || value === null) return value

    const entries = Object.entries(value)
    const compact: Record<string, unknown> = Object.fromEntries(entries.slice(0, 60).map(([name, item]) => [
        name,
        compactValue(item, name)
    ]))

    if (entries.length > 60) compact.omittedProperties = entries.length - 60

    return Object.freeze(compact)
}

function binaryKey(key: string) {

    return /^(?:image|screenshot|frame|blob|base64|data)$/i.test(key)
}
