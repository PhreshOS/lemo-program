import type { ServiceKey } from "@phreshos/core"
import { host } from "@phreshos/server"
import { z } from "zod"
import type Tool from "../../tool"
import docs from "./docs.md?raw"

const identity = z.string().trim().min(1)
const timeout = z.number().int().positive().optional()
const value = z.union([z.number().finite(), z.string().trim().min(1)])
const serviceKey = z.object({
    program: identity,
    endpoint: z.enum(["server", "client"]),
    name: identity
}).strict() satisfies z.ZodType<ServiceKey>
const client = z.object({
    title: z.string().optional(),
    size: z.object({ width: value, height: value }).strict().optional(),
    position: z.object({ x: value, y: value }).strict().optional(),
    layer: z.enum(["window", "under", "over"]).optional(),
    location: z.string().optional(),
    minimize: z.boolean().optional()
}).strict().optional()

const input = z.discriminatedUnion("action", [
    z.object({ action: z.literal("status"), service: serviceKey }).strict(),
    z.object({ action: z.literal("waitReady"), service: serviceKey, timeout }).strict(),
    z.object({
        action: z.literal("createAndWaitReady"),
        service: serviceKey,
        client,
        timeout
    }).strict(),
    z.object({
        action: z.literal("ask"),
        service: serviceKey,
        event: identity,
        payload: z.json().optional(),
        timeout
    }).strict()
])

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

const valueParameters = Object.freeze({ type: Object.freeze(["number", "string"]) })
const serviceParameters = Object.freeze({
    type: "object",
    required: Object.freeze(["program", "endpoint", "name"]),
    properties: Object.freeze({
        program: Object.freeze({ type: "string" }),
        endpoint: Object.freeze({ type: "string", enum: Object.freeze(["server", "client"]) }),
        name: Object.freeze({ type: "string" })
    }),
    additionalProperties: false
})
const clientParameters = Object.freeze({
    type: "object",
    properties: Object.freeze({
        title: Object.freeze({ type: "string" }),
        size: Object.freeze({
            type: "object",
            required: Object.freeze(["width", "height"]),
            properties: Object.freeze({ width: valueParameters, height: valueParameters }),
            additionalProperties: false
        }),
        position: Object.freeze({
            type: "object",
            required: Object.freeze(["x", "y"]),
            properties: Object.freeze({ x: valueParameters, y: valueParameters }),
            additionalProperties: false
        }),
        layer: Object.freeze({ type: "string", enum: Object.freeze(["window", "under", "over"]) }),
        location: Object.freeze({ type: "string" }),
        minimize: Object.freeze({ type: "boolean" })
    }),
    additionalProperties: false
})

/** Operates directly on one exact System Service coordinate. */
const services: Tool = {
    docs,
    definition: Object.freeze({
        name: "services",
        description: "Operate on a documented Endpoint Service through its exact System address.",
        parameters: Object.freeze({
            oneOf: Object.freeze([
                variant(["action", "service"], {
                    action: Object.freeze({ const: "status" }),
                    service: serviceParameters
                }),
                variant(["action", "service"], {
                    action: Object.freeze({ const: "waitReady" }),
                    service: serviceParameters,
                    timeout: Object.freeze({ type: "integer", minimum: 1 })
                }),
                variant(["action", "service"], {
                    action: Object.freeze({ const: "createAndWaitReady" }),
                    service: serviceParameters,
                    client: clientParameters,
                    timeout: Object.freeze({ type: "integer", minimum: 1 })
                }),
                variant(["action", "service", "event"], {
                    action: Object.freeze({ const: "ask" }),
                    service: serviceParameters,
                    event: Object.freeze({ type: "string" }),
                    payload: jsonParameters,
                    timeout: Object.freeze({ type: "integer", minimum: 1 })
                })
            ])
        })
    }),
    async execute(value) {

        const request = input.parse(value)
        const key = await validateService(request.service)
        const service = connection(key)

        if (request.action === "status") {

            return serviceStatus(key, await service.enabled())
        }

        if (request.action === "waitReady") {

            await service.waitReady(request.timeout)

            return serviceStatus(key, true)
        }

        if (request.action === "createAndWaitReady") {

            if (key.endpoint === "server") {

                if (request.client !== undefined) {

                    throw new Error("A Server Service does not accept Client launch configuration")
                }

                await serverConnection(key).createAndWaitReady(request.timeout)
            } else await clientConnection(key).createAndWaitReady(request.client, request.timeout)

            return serviceStatus(key, true)
        }

        if (key.endpoint !== "server") throw new Error("Only a Server Service can be asked")

        const channel = request.timeout === undefined
            ? serverConnection(key).channel
            : serverConnection(key).channel.timeout(request.timeout)

        return "payload" in request
            ? await channel.ask(request.event, request.payload)
            : await channel.ask(request.event)
    },
    modelOutput: serviceModelOutput
}

export default services

/** Removes large transport material only from the disposable text Model context. */
export function serviceModelOutput(output: unknown): unknown {

    const compact = compactValue(output)
    const serialized = JSON.stringify(compact)

    if (serialized.length <= 24_000) return compact

    return Object.freeze({
        kind: "large-service-result",
        originalCharacters: JSON.stringify(output).length,
        contextCharacters: serialized.length,
        preview: serialized.slice(0, 16_000),
        note: "The raw result remains in the Task database; this bounded preview is only for Model context."
    })
}

async function validateService(key: ServiceKey) {

    const program = await host.program.find(key.program)

    if (!program) throw new Error(`Unknown Program "${key.program}"`)

    const endpoint = program[key.endpoint]

    if (!endpoint) throw new Error(`Program "${program.identity}" has no ${key.endpoint} Endpoint`)

    if (!endpoint.hasService()) {

        throw new Error(`Program "${program.identity}" does not declare a ${key.endpoint} Service`)
    }

    if (await endpoint.docs() === null) {

        throw new Error(`Program "${program.identity}" has no installed ${key.endpoint} Service documentation`)
    }

    return Object.freeze({
        program: program.identity,
        endpoint: key.endpoint,
        name: key.name
    }) as ServiceKey
}

function connection(key: ServiceKey) {

    return key.endpoint === "server"
        ? serverConnection(key)
        : clientConnection(key)
}

function serverConnection(key: ServiceKey) {

    return host.service({ program: key.program, endpoint: "server", name: key.name })
}

function clientConnection(key: ServiceKey) {

    return host.service({ program: key.program, endpoint: "client", name: key.name })
}

function serviceStatus(service: ServiceKey, enabled: boolean) {

    return Object.freeze({ service, enabled })
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
