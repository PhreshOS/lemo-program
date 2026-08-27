import { system, type Process } from "@phreshos/server"
import defineTool from "../../define-tool"
import systemTool from "../../system-tool"
import type { ToolContext } from "../../tool"
import waitEvent from "../../wait-event"

const contract = systemTool("process")

/** Reads and controls live Processes through their authoritative Program owners. */
const processes = defineTool({
    order: 6,
    ...contract,
    name: "processes",
    async execute(request, context) {

        if (request.action === "wait") {

            const scoped = request.process
                ? await requiredProcess(request.process, request.program)
                : null
            const payload = scoped
                ? await waitEvent(scoped, request.event, context.invocation.signal, request.timeout)
                : request.program
                    ? await waitEvent(
                        (await requiredProgram(request.program)).process,
                        request.event,
                        context.invocation.signal,
                        request.timeout
                    )
                    : await waitEvent(system.process, request.event, context.invocation.signal, request.timeout)

            return Object.freeze({
                scope: scoped ? "process" : request.program ? "program" : "system",
                ...(scoped ? { process: scoped.identity } : {}),
                ...(request.program ? { program: request.program } : {}),
                event: request.event,
                payload: await processEventPayload(request.event, payload, scoped)
            })
        }

        if (request.action === "list") {

            const found = request.program
                ? await (await requiredProgram(request.program)).process.list()
                : await system.process.list()

            const query = request.search?.toLocaleLowerCase()
            const matching = found.filter(process => (
                !query || [process.identity, process.name]
                    .some(value => value?.toLocaleLowerCase().includes(query))
            ))
            const selected = matching
                .sort((left, right) => right.startedAt.getTime() - left.startedAt.getTime())
                .slice(0, request.limit ?? 30)

            return Object.freeze({
                data: Object.freeze(await Promise.all(selected.map(snapshot))),
                total: matching.length,
                truncated: matching.length > selected.length
            })
        }

        if (request.action === "inspect") {

            return snapshot(await requiredProcess(request.process, request.program))
        }

        if (request.action === "exit") {

            const process = await requiredProcess(request.process, request.program)

            const before = await snapshot(process)

            await process.exit()

            await remember(context, before, "exited", "processes.exit")

            return Object.freeze({ ...before, exited: true })
        }

        const program = await requiredProgram(request.program)

        const process = request.action === "create"
            ? await program.process.create(request.launch)
            : await program.process.findOrCreate(request.launch)

        const result = await snapshot(process)

        await remember(
            context,
            result,
            request.action === "create" ? "created" : "resolved",
            `processes.${request.action}`
        )

        return result
    }
})

export default processes

async function requiredProgram(identity: string) {

    const program = await system.program.find(identity)

    if (!program) throw new Error(`Unknown Program "${identity}"`)

    return program
}

async function requiredProcess(identityOrName: string, programIdentity?: string) {

    const process = programIdentity
        ? await (await requiredProgram(programIdentity)).process.find(identityOrName)
        : await system.process.find(identityOrName)

    if (!process) {

        const scope = programIdentity ? ` in Program "${programIdentity}"` : ""

        throw new Error(`Unknown Process "${identityOrName}"${scope}`)
    }

    return process
}

async function snapshot(process: Process) {

    const program = await process.program()

    const [server, client] = await Promise.all([
        process.server.exists(),
        process.client.exists()
    ])

    return Object.freeze({
        identity: process.identity,
        name: process.name,
        program: program.identity,
        startedAt: process.startedAt.toISOString(),
        server: Object.freeze({ declared: program.server !== null, running: server }),
        client: Object.freeze({ declared: program.client !== null, running: client })
    })
}

async function remember(
    context: ToolContext,
    process: Awaited<ReturnType<typeof snapshot>>,
    action: "created" | "resolved" | "exited",
    method: string
) {

    const name = process.name ? ` named "${process.name}"` : ""

    await context.memory.record({
        content: `Process "${process.identity}"${name} for Program "${process.program}" was ${action}.`,
        source: `phreshos:process:${process.identity}`,
        method
    })
}

async function processEventPayload(
    event: "endpointStart" | "endpointStop" | "create" | "exit",
    value: unknown,
    scoped: Process | null
) {

    if (event === "create") return snapshot(value as Process)

    if (event === "endpointStart" || event === "endpointStop") {

        const endpoint = value as Process["server"] | Process["client"]
        const process = await endpoint.process()

        return Object.freeze({
            process: process.identity,
            endpoint: endpoint === process.server ? "server" : "client"
        })
    }

    const payload = value as {
        process?: Process
        status: "exited" | "signaled"
        code: number | null
        signal: string | null
    }

    return Object.freeze({
        process: payload.process?.identity ?? scoped?.identity ?? null,
        status: payload.status,
        code: payload.code,
        signal: payload.signal
    })
}
