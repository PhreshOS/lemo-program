import { host } from "@phreshos/server"
import { z } from "zod"
import {
    issueServiceAccess,
    readEndpointContract,
    readServiceAccess,
    verifyEndpointContract,
    type EndpointContract
} from "../../service-access"
import type Tool from "../../tool"
import type { ToolContext } from "../../tool"
import docs from "./docs.md?raw"

const identity = z.string().trim().min(1)
const timeout = z.number().int().positive().optional()
const value = z.union([z.number().finite(), z.string().trim().min(1)])
const client = z.object({
    title: z.string().optional(),
    size: z.object({ width: value, height: value }).strict().optional(),
    position: z.object({ x: value, y: value }).strict().optional(),
    layer: z.enum(["window", "under", "over"]).optional(),
    location: z.string().optional(),
    minimize: z.boolean().optional()
}).strict().optional()

const input = z.discriminatedUnion("action", [
    z.object({
        action: z.literal("connect"),
        contract: identity,
        name: z.string().trim().min(1)
    }).strict(),
    z.object({
        action: z.literal("status"),
        service: identity
    }).strict(),
    z.object({
        action: z.literal("waitReady"),
        service: identity,
        timeout
    }).strict(),
    z.object({
        action: z.literal("createAndWaitReady"),
        service: identity,
        client,
        timeout
    }).strict(),
    z.object({
        action: z.literal("ask"),
        service: identity,
        event: z.string().trim().min(1),
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

/** Connects Lemo to one Service through a current documented Endpoint contract. */
const services: Tool = {
    docs,
    definition: Object.freeze({
        name: "services",
        description: "Connect to a documented Endpoint Service, then operate through its durable handle.",
        parameters: Object.freeze({
            oneOf: Object.freeze([
                variant(["action", "contract", "name"], {
                    action: Object.freeze({ const: "connect" }),
                    contract: Object.freeze({ type: "string" }),
                    name: Object.freeze({ type: "string" })
                }),
                variant(["action", "service"], {
                    action: Object.freeze({ const: "status" }),
                    service: Object.freeze({ type: "string" })
                }),
                variant(["action", "service"], {
                    action: Object.freeze({ const: "waitReady" }),
                    service: Object.freeze({ type: "string" }),
                    timeout: Object.freeze({ type: "integer", minimum: 1 })
                }),
                variant(["action", "service"], {
                    action: Object.freeze({ const: "createAndWaitReady" }),
                    service: Object.freeze({ type: "string" }),
                    client: clientParameters,
                    timeout: Object.freeze({ type: "integer", minimum: 1 })
                }),
                variant(["action", "service", "event"], {
                    action: Object.freeze({ const: "ask" }),
                    service: Object.freeze({ type: "string" }),
                    event: Object.freeze({ type: "string" }),
                    payload: jsonParameters,
                    timeout: Object.freeze({ type: "integer", minimum: 1 })
                })
            ])
        })
    }),
    async execute(value, context) {

        const request = input.parse(value)

        if (request.action === "connect") {

            const contract = await validateContract(request.contract, context)
            const service = issueServiceAccess(request.contract, request.name)

            return serviceStatus(
                service,
                contract,
                request.name,
                await connection(contract, request.name).enabled()
            )
        }

        const access = readServiceAccess(request.service)
        const contract = await validateContract(access.contract, context)
        const service = connection(contract, access.name)

        if (request.action === "status") {

            return serviceStatus(request.service, contract, access.name, await service.enabled())
        }

        if (request.action === "waitReady") {

            await service.waitReady(request.timeout)

            return serviceStatus(request.service, contract, access.name, true)
        }

        if (request.action === "createAndWaitReady") {

            if (contract.endpoint === "server") {

                if (request.client !== undefined) {

                    throw new Error("A Server Service does not accept Client launch configuration")
                }

                await host.service({
                    program: contract.program,
                    endpoint: "server",
                    name: access.name
                }).createAndWaitReady(request.timeout)
            } else await host.service({
                program: contract.program,
                endpoint: "client",
                name: access.name
            }).createAndWaitReady(request.client, request.timeout)

            return serviceStatus(request.service, contract, access.name, true)
        }

        if (contract.endpoint !== "server") throw new Error("Only a Server Service can be asked")

        const server = host.service({
            program: contract.program,
            endpoint: "server",
            name: access.name
        })

        const ask = request.timeout === undefined
            ? server.channel
            : server.channel.timeout(request.timeout)

        return "payload" in request
            ? await ask.ask(request.event, request.payload)
            : await ask.ask(request.event)
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

async function validateContract(identity: string, context: ToolContext) {

    const access = readEndpointContract(identity)
    const program = await host.program.find(access.program)

    if (!program) throw new Error(`Unknown Program "${access.program}"`)

    const endpoint = program[access.endpoint]

    if (!endpoint) throw new Error(`Program "${program.identity}" has no ${access.endpoint} Endpoint`)

    if (!endpoint.hasService()) {

        throw new Error(`Program "${program.identity}" does not declare a ${access.endpoint} Service`)
    }

    const documentation = await endpoint.docs()

    if (documentation === null) {

        throw new Error(`Program "${program.identity}" has no installed ${access.endpoint} Service documentation`)
    }

    return verifyEndpointContract(identity, context.task, documentation)
}

function connection(contract: EndpointContract, name: string) {

    return contract.endpoint === "server"
        ? host.service({ program: contract.program, endpoint: "server", name })
        : host.service({ program: contract.program, endpoint: "client", name })
}

function serviceStatus(
    service: string,
    contract: EndpointContract,
    name: string,
    enabled: boolean
) {

    return Object.freeze({
        service,
        program: contract.program,
        endpoint: contract.endpoint,
        name,
        enabled
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
