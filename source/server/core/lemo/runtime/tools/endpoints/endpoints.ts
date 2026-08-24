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

/** Reads and controls individual Process Endpoints. */
const endpoints: Tool = {
    docs,
    definition: Object.freeze({
        name: "endpoints",
        description: "Inspect, start, stop, or await readiness of PhreshOS Process Endpoints.",
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
                })
            ])
        })
    }),
    async execute(value, context) {

        const request = input.parse(value)

        const process = await requiredProcess(request.process, request.program)

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
    }
}

export default endpoints

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

    const service = running ? await process[endpoint].service() : null

    return Object.freeze({
        process: process.identity,
        program: program.identity,
        endpoint,
        declared: declaration !== null,
        running,
        serviceEnabled: service !== null
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

function variant(required: readonly string[], properties: Readonly<Record<string, unknown>>) {

    return Object.freeze({
        type: "object",
        required: Object.freeze(required),
        properties: Object.freeze(properties),
        additionalProperties: false
    })
}
