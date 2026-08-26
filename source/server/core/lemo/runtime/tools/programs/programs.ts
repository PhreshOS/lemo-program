import { host, type Program } from "@phreshos/server"
import { z } from "zod"
import defineTool from "../../define-tool"
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
const programs = defineTool({
    order: 5,
    docs,
    input,
    name: "programs",
    description: "Learn a PhreshOS Program and read its operating policy before acting on it.",
    async execute(request, context) {

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
