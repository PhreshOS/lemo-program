import { host } from "@phreshos/server"
import { z } from "zod"
import type Tool from "../../tool"
import docs from "./docs.md?raw"

const coordinates = {
    program: z.string().trim().min(1),
    endpoint: z.enum(["server", "client"]),
    name: z.string().trim().min(1)
}

const timeout = z.number().int().positive().optional()

const input = z.discriminatedUnion("action", [
    z.object({
        action: z.literal("status"),
        ...coordinates
    }).strict(),
    z.object({
        action: z.literal("waitReady"),
        ...coordinates,
        timeout
    }).strict(),
    z.object({
        action: z.literal("ask"),
        program: coordinates.program,
        endpoint: z.literal("server"),
        name: coordinates.name,
        event: z.string().trim().min(1),
        payload: z.unknown().optional(),
        timeout
    }).strict()
])

const coordinateParameters = Object.freeze({
    program: Object.freeze({ type: "string" }),
    endpoint: Object.freeze({ type: "string", enum: Object.freeze(["server", "client"]) }),
    name: Object.freeze({ type: "string" })
})

/** Connects Lemo to one exact documented Endpoint Service. */
const services: Tool = {
    docs,
    definition: Object.freeze({
        name: "services",
        description: "Check, await, or ask one exact documented PhreshOS Endpoint Service.",
        parameters: Object.freeze({
            oneOf: Object.freeze([
                variant(["action", "program", "endpoint", "name"], {
                    action: Object.freeze({ const: "status" }),
                    ...coordinateParameters
                }),
                variant(["action", "program", "endpoint", "name"], {
                    action: Object.freeze({ const: "waitReady" }),
                    ...coordinateParameters,
                    timeout: Object.freeze({ type: "integer", minimum: 1 })
                }),
                variant(["action", "program", "endpoint", "name", "event"], {
                    action: Object.freeze({ const: "ask" }),
                    program: coordinateParameters.program,
                    endpoint: Object.freeze({ const: "server" }),
                    name: coordinateParameters.name,
                    event: Object.freeze({ type: "string" }),
                    payload: Object.freeze({}),
                    timeout: Object.freeze({ type: "integer", minimum: 1 })
                })
            ])
        })
    }),
    async execute(value) {

        const request = input.parse(value)

        await requireDeclaredService(request.program, request.endpoint)

        if (request.endpoint === "client") {

            const service = host.service({
                program: request.program,
                endpoint: "client",
                name: request.name
            })

            if (request.action === "status") return status(request, await service.enabled())

            await service.waitReady(request.timeout)

            return status(request, true)
        }

        const service = host.service({
            program: request.program,
            endpoint: "server",
            name: request.name
        })

        if (request.action === "status") return status(request, await service.enabled())

        if (request.action === "waitReady") {

            await service.waitReady(request.timeout)

            return status(request, true)
        }

        const ask = request.timeout === undefined
            ? service.channel
            : service.channel.timeout(request.timeout)

        return "payload" in request
            ? await ask.ask(request.event, request.payload)
            : await ask.ask(request.event)
    }
}

export default services

async function requireDeclaredService(programIdentity: string, endpoint: "server" | "client") {

    const program = await host.program.find(programIdentity)

    if (!program) throw new Error(`Unknown Program "${programIdentity}"`)

    const declaration = program[endpoint]

    if (!declaration) throw new Error(`Program "${programIdentity}" has no ${endpoint} Endpoint`)

    if (!declaration.hasService()) {

        throw new Error(`Program "${programIdentity}" does not declare a ${endpoint} Service`)
    }
}

function status(
    coordinates: Readonly<{ program: string; endpoint: "server" | "client"; name: string }>,
    enabled: boolean
) {

    return Object.freeze({
        program: coordinates.program,
        endpoint: coordinates.endpoint,
        name: coordinates.name,
        enabled
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

