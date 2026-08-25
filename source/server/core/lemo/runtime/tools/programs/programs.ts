import { host, type Program } from "@phreshos/server"
import { z } from "zod"
import type Tool from "../../tool"
import waitEvent from "../../wait-event"
import docs from "./docs.md?raw"

const registryEvent = z.enum(["create", "forget", "install", "uninstall"])
const programEvent = z.enum(["forget", "uninstall"])

const input = z.discriminatedUnion("action", [
    z.object({
        action: z.literal("list"),
        installedOnly: z.boolean().optional()
    }).strict(),
    z.object({
        action: z.literal("inspect"),
        program: z.string().trim().min(1)
    }).strict(),
    z.object({
        action: z.literal("agent"),
        program: z.string().trim().min(1)
    }).strict(),
    z.object({
        action: z.literal("wait"),
        event: registryEvent,
        program: z.string().trim().min(1).optional(),
        timeout: z.number().int().positive().optional()
    }).strict()
]).refine(request => (
    request.action !== "wait"
    || request.program === undefined
    || programEvent.safeParse(request.event).success
), { message: "A specific Program emits only forget and uninstall events" })

/** Reads installed Program and Endpoint declarations from the authoritative Host. */
const programs: Tool = {
    order: 5,
    docs,
    definition: Object.freeze({
        name: "programs",
        description: "Learn a PhreshOS Program and read its operating policy before acting on it.",
        parameters: Object.freeze({
            oneOf: Object.freeze([
                Object.freeze({
                    type: "object",
                    required: Object.freeze(["action"]),
                    properties: Object.freeze({
                        action: Object.freeze({ const: "list" }),
                        installedOnly: Object.freeze({ type: "boolean", default: true })
                    }),
                    additionalProperties: false
                }),
                Object.freeze({
                    type: "object",
                    required: Object.freeze(["action", "program"]),
                    properties: Object.freeze({
                        action: Object.freeze({ const: "inspect" }),
                        program: Object.freeze({ type: "string" })
                    }),
                    additionalProperties: false
                }),
                Object.freeze({
                    type: "object",
                    required: Object.freeze(["action", "program"]),
                    properties: Object.freeze({
                        action: Object.freeze({ const: "agent" }),
                        program: Object.freeze({ type: "string" })
                    }),
                    additionalProperties: false
                }),
                Object.freeze({
                    type: "object",
                    required: Object.freeze(["action", "event"]),
                    properties: Object.freeze({
                        action: Object.freeze({ const: "wait" }),
                        event: Object.freeze({
                            type: "string",
                            enum: Object.freeze(["create", "forget", "install", "uninstall"])
                        }),
                        program: Object.freeze({
                            type: "string",
                            description: "When supplied, wait on this Program entity; only forget and uninstall are valid."
                        }),
                        timeout: Object.freeze({ type: "integer", minimum: 1 })
                    }),
                    additionalProperties: false
                })
            ])
        })
    }),
    async execute(value, context) {

        const request = input.parse(value)

        if (request.action === "wait") {

            if (request.program) {

                const program = await host.program.find(request.program)

                if (!program) throw new Error(`Unknown Program "${request.program}"`)

                return Object.freeze({
                    scope: "program",
                    program: eventProgram(program),
                    event: request.event,
                    payload: await waitEvent(program, request.event, context.invocation.signal, request.timeout)
                })
            }

            const payload = await waitEvent(host.program, request.event, context.invocation.signal, request.timeout)

            return Object.freeze({
                scope: "host",
                event: request.event,
                payload: registryPayload(request.event, payload)
            })
        }

        if (request.action === "list") {

            const installedOnly = request.installedOnly ?? true

            return await Promise.all((await host.program.list(installedOnly)).map(program => (
                summary(program, installedOnly ? true : undefined)
            )))
        }

        const program = await host.program.find(request.program)

        if (!program) throw new Error(`Unknown Program "${request.program}"`)

        if (request.action === "inspect") return details(program, await program.installed())

        const content = await program.agent()

        if (content === null) {

            throw new Error(`Program "${program.identity}" has no agent documentation`)
        }

        return Object.freeze({
            program: program.identity,
            content
        })
    }
}

export default programs

async function summary(program: Program, knownInstalled?: boolean) {

    return Object.freeze({
        identity: program.identity,
        name: program.name,
        version: program.version,
        description: program.description,
        hasAgent: program.hasAgent,
        installed: knownInstalled ?? await program.installed(),
        server: declaration(program.server),
        client: declaration(program.client)
    })
}

async function details(program: Program, installed: boolean) {

    return Object.freeze({
        ...await summary(program, installed),
        client: program.client
            ? Object.freeze({
                ...declaration(program.client),
                title: program.client.title,
                size: program.client.size,
                position: program.client.position,
                layer: program.client.layer,
                minimize: program.client.minimize
            })
            : null
    })
}

function declaration(endpoint: Program["server"] | Program["client"]) {

    return endpoint
        ? Object.freeze({ start: endpoint.start })
        : null
}

function registryPayload(event: "create" | "forget" | "install" | "uninstall", value: unknown) {

    if (event === "uninstall") {

        const payload = value as { program: Program, everythingRemoved: boolean }

        return Object.freeze({
            program: eventProgram(payload.program),
            everythingRemoved: payload.everythingRemoved
        })
    }

    return eventProgram(value as Program)
}

function eventProgram(program: Program) {

    return Object.freeze({
        identity: program.identity,
        name: program.name,
        version: program.version,
        description: program.description,
        hasAgent: program.hasAgent,
        server: declaration(program.server),
        client: declaration(program.client)
    })
}
