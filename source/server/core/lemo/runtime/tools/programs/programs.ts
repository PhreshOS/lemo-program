import { host, type Program } from "@phreshos/server"
import { z } from "zod"
import { issueEndpointContract } from "../../service-access"
import type Tool from "../../tool"
import docs from "./docs.md?raw"

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
        action: z.literal("docs"),
        program: z.string().trim().min(1),
        endpoint: z.enum(["server", "client"])
    }).strict()
])

/** Reads installed Program and Endpoint declarations from the authoritative Host. */
const programs: Tool = {
    docs,
    definition: Object.freeze({
        name: "programs",
        description: "List and inspect PhreshOS Programs or read an Endpoint's Service documentation.",
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
                    required: Object.freeze(["action", "program", "endpoint"]),
                    properties: Object.freeze({
                        action: Object.freeze({ const: "docs" }),
                        program: Object.freeze({ type: "string" }),
                        endpoint: Object.freeze({ type: "string", enum: Object.freeze(["server", "client"]) })
                    }),
                    additionalProperties: false
                })
            ])
        })
    }),
    async execute(value, context) {

        const request = input.parse(value)

        if (request.action === "list") {

            const installedOnly = request.installedOnly ?? true

            return await Promise.all((await host.program.list(installedOnly)).map(program => (
                summary(program, installedOnly ? true : undefined)
            )))
        }

        const program = await host.program.find(request.program)

        if (!program) throw new Error(`Unknown Program "${request.program}"`)

        if (request.action === "inspect") return details(program, await program.installed())

        const endpoint = program[request.endpoint]

        if (!endpoint) {

            throw new Error(`Program "${program.identity}" has no ${request.endpoint} Endpoint`)
        }

        if (!endpoint.hasService()) {

            throw new Error(`Program "${program.identity}" does not declare a ${request.endpoint} Service`)
        }

        const content = await endpoint.docs()

        if (content === null) {

            throw new Error(`Program "${program.identity}" has no installed ${request.endpoint} Service documentation`)
        }

        return Object.freeze({
            program: program.identity,
            endpoint: request.endpoint,
            contract: issueEndpointContract({
                task: context.task,
                program: program.identity,
                endpoint: request.endpoint,
                documentation: content
            }),
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
        ? Object.freeze({ start: endpoint.start, hasService: endpoint.hasService() })
        : null
}
