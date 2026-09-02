import { system, type Program } from "@phreshos/server"
import defineTool from "../../define-tool"
import systemTool from "../../system-tool"
import waitEvent from "../../wait-event"

const contract = systemTool("program")

/** Reads installed Program and Endpoint declarations from the authoritative Host. */
const programs = defineTool({
    order: 5,
    ...contract,
    name: "programs",
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
            const selected = found
                .sort((left, right) => left.identity.localeCompare(right.identity))
                .slice(0, request.limit ?? 30)

            return Object.freeze({
                data: Object.freeze(await Promise.all(selected.map(program => summary(program, installedOnly ? true : undefined)))),
                total: found.length,
                truncated: found.length > selected.length
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
