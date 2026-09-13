import { system } from "@phreshos/server"
import type { Process, Window, WindowEvents, WindowOperations, WindowState } from "@phreshos/core"
import { z } from "zod"
import defineTool from "../../define-tool"
import waitEvent from "../../wait-event"
import docs from "./docs.md?raw"
import { identity, position, size } from "../../system-input"

const coordinates = { process: identity, program: identity.optional() }
const timeout = z.number().int().positive().optional()
const events = {
    move: "move", resize: "resize", geometry: "geometry", minimize: "minimize",
    maximize: "maximize", changeTitle: "changeTitle", front: "front"
} as const satisfies { [Event in keyof WindowEvents]: Event }

const operations = {
    move: z.object({ action: z.literal("move"), ...coordinates, position }).strict(),
    resize: z.object({ action: z.literal("resize"), ...coordinates, size }).strict(),
    setGeometry: z.object({ action: z.literal("setGeometry"), ...coordinates, position, size }).strict(),
    minimize: z.object({ action: z.literal("minimize"), ...coordinates, minimized: z.boolean().optional() }).strict(),
    maximize: z.object({ action: z.literal("maximize"), ...coordinates, maximized: z.boolean().optional() }).strict(),
    changeTitle: z.object({ action: z.literal("changeTitle"), ...coordinates, title: z.string() }).strict(),
    raise: z.object({ action: z.literal("raise"), ...coordinates }).strict()
} satisfies { [Operation in keyof WindowOperations]: z.ZodType<{ action: Operation }> }

const input = z.discriminatedUnion("action", [
    z.object({ action: z.literal("inspect"), ...coordinates }).strict(),
    ...Object.values(operations),
    z.object({
        action: z.literal("wait"),
        ...coordinates,
        event: z.enum(events),
        timeout
    }).strict()
])

/** Reads and controls the authoritative Window of one live Client Endpoint. */
const windows = defineTool({
    order: 9,
    docs,
    input,
    name: "windows",
    description: "Inspect and control the authoritative Window of a live Client Endpoint.",
    async execute(request, context) {

        const process = await requiredProcess(request.process, request.program)

        const window = await requiredWindow(process)

        if (request.action === "wait") {

            return Object.freeze({
                process: process.identity,
                event: request.event,
                payload: await waitEvent(window, request.event, context.invocation.signal, request.timeout)
            })
        }

        if (request.action === "inspect") return snapshot(process, window)

        if (request.action === "move") await window.move(request.position)
        else if (request.action === "resize") await window.resize(request.size)
        else if (request.action === "setGeometry") {

            await window.setGeometry({ position: request.position, size: request.size })
        } else if (request.action === "minimize") await window.minimize(request.minimized)
        else if (request.action === "maximize") await window.maximize(request.maximized)
        else if (request.action === "changeTitle") await window.changeTitle(request.title)
        else if (request.action === "raise") await window.raise()
        else request satisfies never

        return snapshot(process, window)
    }
})

export default windows

async function requiredProcess(identityOrName: string, programIdentity?: string) {

    if (!programIdentity) {

        const process = await system.process.find(identityOrName)

        if (process) return process

        throw new Error(`Unknown Process "${identityOrName}"`)
    }

    const program = await system.program.find(programIdentity)

    if (!program) throw new Error(`Unknown Program "${programIdentity}"`)

    const process = await program.process.find(identityOrName)

    if (!process) throw new Error(`Unknown Process "${identityOrName}" in Program "${programIdentity}"`)

    return process
}

async function requiredWindow(process: Process) {

    const program = await process.program()

    if (!program.client) throw new Error(`Program "${program.identity}" does not declare a Client Endpoint`)

    if (!await process.client.exists()) throw new Error(`Process "${process.identity}" has no running Client Endpoint`)

    return process.client.window
}

async function snapshot(process: Process, window: Window) {

    const [title, position, size, minimized, maximized, front, layer] = await Promise.all([
        window.title(),
        window.position(),
        window.size(),
        window.minimized(),
        window.maximized(),
        window.front(),
        window.layer()
    ])

    return Object.freeze({
        process: process.identity,
        title,
        position,
        size,
        minimized,
        maximized,
        front,
        layer
    } satisfies WindowState & { process: string })
}
