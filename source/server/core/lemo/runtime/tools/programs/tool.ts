import { system, type Program } from "@phreshos/server"
import { z } from "zod"
import defineTool from "../../define-tool"
import waitEvent from "../../wait-event"
import docs from "./docs.md?raw"

const program = z.string().trim().min(1).describe("Program identity.")

const input = z.discriminatedUnion("action", [
    z.object({
        action: z.literal("list"),
        installedOnly: z.boolean().optional(),
        search: z.string().trim().min(1).optional(),
        limit: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().nonnegative().optional()
    }).strict(),
    z.object({ action: z.literal("inspect"), program }).strict(),
    z.object({ action: z.literal("agent"), program }).strict(),
    z.object({
        action: z.literal("wait"),
        event: z.enum(["create", "forget", "install", "uninstall"]),
        program: program.optional(),
        timeout: z.number().int().positive().optional()
    }).strict()
]).superRefine((request, context) => {
    if (request.action !== "wait" || !request.program) return
    if (request.event === "forget" || request.event === "uninstall") return

    context.addIssue({
        code: "custom",
        message: "An individual Program emits only forget and uninstall"
    })
})

/** Reads installed Program and Endpoint declarations from the authoritative Host. */
const programs = defineTool({
    order: 5,
    docs,
    input,
    name: "programs",
    description: "Discover PhreshOS Programs and their Program-specific agent documentation.",
    async execute(request, context) {

        if (request.action === "wait") {

            if (request.program) {

                const program = await system.program.find(request.program)

                if (!program) throw new Error(`Unknown Program "${request.program}"`)

                return Object.freeze({
                    scope: "program",
                    program: eventProgram(program),
                    event: request.event,
                    payload: await waitEvent(program, request.event, context.invocation.signal, request.timeout)
                })
            }

            const payload = await waitEvent(system.program, request.event, context.invocation.signal, request.timeout)

            return Object.freeze({
                scope: "system",
                event: request.event,
                payload: registryPayload(request.event, payload)
            })
        }

        if (request.action === "list") {

            const installedOnly = request.installedOnly ?? true

            const query = request.search?.toLocaleLowerCase()
            const found = (await system.program.list(installedOnly)).filter(program => (
                !query || [program.identity, program.name, program.description]
                    .some(value => value?.toLocaleLowerCase().includes(query))
            ))
            const offset = request.offset ?? 0
            const selected = found
                .sort((left, right) => left.identity.localeCompare(right.identity))
                .slice(offset, offset + (request.limit ?? 30))

            return Object.freeze({
                data: Object.freeze(await Promise.all(selected.map(program => summary(program, installedOnly ? true : undefined)))),
                total: found.length,
                truncated: offset + selected.length < found.length
            })
        }

        const program = await system.program.find(request.program)

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
})

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

        const payload = value as { program: Program, everything: boolean }

        return Object.freeze({
            program: eventProgram(payload.program),
            everything: payload.everything
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
