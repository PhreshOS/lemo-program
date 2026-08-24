import { host, type Process } from "@phreshos/server"
import { z } from "zod"
import type Tool from "../../tool"
import docs from "./docs.md?raw"

const coordinates = {
    process: z.string().trim().min(1),
    program: z.string().trim().min(1).optional()
}

const endpoint = z.enum(["server", "client"])

const input = z.discriminatedUnion("action", [
    z.object({
        action: z.literal("inspect"),
        ...coordinates,
        endpoint
    }).strict(),
    z.object({
        action: z.literal("start"),
        ...coordinates,
        endpoint
    }).strict(),
    z.object({
        action: z.literal("stop"),
        ...coordinates,
        endpoint
    }).strict(),
    z.object({
        action: z.literal("waitReady"),
        ...coordinates,
        endpoint: z.literal("server"),
        timeout: z.number().int().positive().optional()
    }).strict(),
    z.object({
        action: z.literal("ask"),
        ...coordinates,
        endpoint: z.literal("server"),
        event: z.string().trim().min(1),
        payload: z.json().optional(),
        timeout: z.number().int().positive().optional()
    }).strict(),
    z.object({
        action: z.literal("publish"),
        ...coordinates,
        endpoint,
        event: z.string().trim().min(1),
        payload: z.json().optional()
    }).strict()
])

const coordinateParameters = Object.freeze({
    process: Object.freeze({ type: "string" }),
    program: Object.freeze({ type: "string" })
})

const endpointParameters = Object.freeze({
    type: "string",
    enum: Object.freeze(["server", "client"])
})

const jsonParameters = Object.freeze({
    oneOf: Object.freeze([
        Object.freeze({ type: "object" }),
        Object.freeze({ type: "array", items: Object.freeze({}) }),
        Object.freeze({ type: "string" }),
        Object.freeze({ type: "number" }),
        Object.freeze({ type: "boolean" }),
        Object.freeze({ type: "null" })
    ])
})

/** Reads and controls individual Process Endpoints. */
const endpoints: Tool = {
    docs,
    definition: Object.freeze({
        name: "endpoints",
        description: "Inspect, control, and communicate directly with PhreshOS Process Endpoints.",
        parameters: Object.freeze({
            oneOf: Object.freeze([
                endpointVariant("inspect"),
                endpointVariant("start"),
                endpointVariant("stop"),
                variant(["action", "process", "endpoint"], {
                    action: Object.freeze({ const: "waitReady" }),
                    ...coordinateParameters,
                    endpoint: Object.freeze({ const: "server" }),
                    timeout: Object.freeze({ type: "integer", minimum: 1 })
                }),
                variant(["action", "process", "endpoint", "event"], {
                    action: Object.freeze({ const: "ask" }),
                    ...coordinateParameters,
                    endpoint: Object.freeze({ const: "server" }),
                    event: Object.freeze({ type: "string" }),
                    payload: jsonParameters,
                    timeout: Object.freeze({ type: "integer", minimum: 1 })
                }),
                variant(["action", "process", "endpoint", "event"], {
                    action: Object.freeze({ const: "publish" }),
                    ...coordinateParameters,
                    endpoint: endpointParameters,
                    event: Object.freeze({ type: "string" }),
                    payload: jsonParameters
                })
            ])
        })
    }),
    async execute(value, context) {

        const request = input.parse(value)

        const process = await requiredProcess(request.process, request.program)

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

        if (request.action === "inspect") return snapshot(process, request.endpoint)

        await requireEndpoint(process, request.endpoint)

        const target = process[request.endpoint]

        if (request.action === "start") await target.start()
        else await target.stop()

        const result = await snapshot(process, request.endpoint)

        await context.memory.record({
            content: `${endpointName(result)} was ${request.action === "start" ? "started" : "stopped"}.`,
            source: `phreshos:endpoint:${result.process}:${result.endpoint}`,
            method: `endpoints.${request.action}`
        })

        return result
    },
    modelOutput: endpointModelOutput
}

export default endpoints

/** Removes large transport material only from the disposable text Model context. */
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

        const process = await host.process.find(identityOrName)

        if (process) return process

        throw new Error(`Unknown Process "${identityOrName}"`)
    }

    const program = await host.program.find(programIdentity)

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

    const running = await process[endpoint].exists()

    return Object.freeze({
        process: process.identity,
        program: program.identity,
        endpoint,
        declared: declaration !== null,
        running
    })
}

function endpointName(value: Awaited<ReturnType<typeof snapshot>>) {

    return `The ${value.endpoint} Endpoint of Process "${value.process}" in Program "${value.program}"`
}

function endpointVariant(action: "inspect" | "start" | "stop") {

    return variant(["action", "process", "endpoint"], {
        action: Object.freeze({ const: action }),
        ...coordinateParameters,
        endpoint: endpointParameters
    })
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

function variant(required: readonly string[], properties: Readonly<Record<string, unknown>>) {

    return Object.freeze({
        type: "object",
        required: Object.freeze(required),
        properties: Object.freeze(properties),
        additionalProperties: false
    })
}
