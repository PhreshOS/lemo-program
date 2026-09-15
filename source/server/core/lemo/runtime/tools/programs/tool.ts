import { system } from "@phreshos/server"
import type { Process, Program, ProgramProcessExit } from "@phreshos/core"
import { z } from "zod"
import defineTool from "../../define-tool"
import waitEvent from "../../wait-event"
import docs from "./docs.md?raw"
import { launch } from "../../system-input"
import { tokenSlice } from "../../../token-budget"

const program = z.string().trim().min(1).describe("Program identity.")

const input = z.discriminatedUnion("action", [
    z.object({
        action: z.literal("list"),
        installedOnly: z.boolean().optional(),
        search: z.string().trim().min(1).optional(),
        limit: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().nonnegative().optional()
    }),
    z.object({ action: z.literal("inspect"), program }),
    z.object({
        action: z.literal("agent"), program,
        offset: z.number().int().nonnegative().optional(),
        tokens: z.number().int().min(256).max(16_000).optional()
    }),
    z.object({ action: z.literal("getLaunch"), program }),
    z.object({ action: z.literal("setLaunch"), program, launch }),
    z.object({
        action: z.literal("wait"),
        event: z.enum(["create", "forget", "install", "uninstall", "processCreate", "processExit"]),
        program: program.optional(),
        timeout: z.number().int().positive().optional()
    })
]).superRefine((request, context) => {
    if (request.action !== "wait") return

    if (request.program && (request.event === "create" || request.event === "install")) {
        context.addIssue({ code: "custom", message: `An individual Program does not emit ${request.event}` })
    }

    if (!request.program && (request.event === "processCreate" || request.event === "processExit")) {
        context.addIssue({ code: "custom", message: `${request.event} belongs to an individual Program` })
    }
})

/** Reads installed Program and Endpoint declarations from the authoritative Host. */
const programs = defineTool({
    order: 5,
    docs,
    input,
    name: "programs",
    // Keep declarations, launch configuration and bounded discovery results.
    retain: (output, request) => request.action === "agent" ? null : output,
    description: "Discover PhreshOS Programs and their Program-specific agent documentation.",
    async execute(request, context) {

        if (request.action === "wait") {

            if (request.program) {

                if (request.event === "create" || request.event === "install") throw new Error(`${request.event} belongs to the Program registry`)

                const program = await system.program.find(request.program)

                if (!program) throw new Error(`Unknown Program "${request.program}"`)

                const payload = await waitEvent(program, request.event, context.invocation.signal, request.timeout)

                return Object.freeze({
                    scope: "program",
                    program: eventProgram(program),
                    event: request.event,
                    payload: await programPayload(request.event, payload)
                })
            }

            if (request.event === "processCreate" || request.event === "processExit") throw new Error(`${request.event} belongs to an individual Program`)

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

        if (request.action === "getLaunch") return program.launch.get()

        if (request.action === "setLaunch") {
            await program.launch.set(request.launch)
            return program.launch.get()
        }

        const content = await program.agent()

        if (content === null) {

            throw new Error(`Program "${program.identity}" has no agent documentation`)
        }

        const offset = request.offset ?? 0
        const page = tokenSlice(content, request.tokens ?? 2_048, offset)
        return Object.freeze({
            program: program.identity,
            content: page.content, offset, next: page.next, tokens: page.tokens, totalTokens: page.total
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
        server: program.server,
        client: program.client
    })
}

function declaration(endpoint: Program["server"] | Program["client"]) {

    return endpoint
        ? Object.freeze({ start: endpoint.start, service: endpoint.service } satisfies Program["server"])
        : null
}

function registryPayload(event: "create" | "forget" | "install" | "uninstall", value: unknown) {

    if (event === "uninstall") {

        const payload = value as { program: Program, purge: boolean }

        return Object.freeze({
            program: eventProgram(payload.program),
            purge: payload.purge
        })
    }

    return eventProgram(value as Program)
}

async function programPayload(event: "forget" | "uninstall" | "processCreate" | "processExit", value: unknown) {

    if (event === "processCreate") return processPayload(value as Process)

    if (event === "processExit") {
        const payload = value as ProgramProcessExit
        return Object.freeze({ process: await processPayload(payload.process), status: payload.status, code: payload.code, signal: payload.signal })
    }

    if (event === "uninstall") return Object.freeze({ purge: (value as { purge: boolean }).purge })

    return undefined
}

async function processPayload(process: Process) {
    return Object.freeze({
        identity: process.identity,
        name: process.name,
        program: (await process.program()).identity,
        startedAt: process.startedAt.toISOString()
    })
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
