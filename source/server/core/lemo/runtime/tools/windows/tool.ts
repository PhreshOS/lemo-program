import { system, type Process, type Window } from "@phreshos/server"
import { z } from "zod"
import defineTool from "../../define-tool"
import waitEvent from "../../wait-event"
import docs from "./docs.md?raw"

const identity = z.string().trim().min(1)
const coordinates = { process: identity, program: identity.optional() }
const value = z.union([z.number(), z.string().trim().min(1)])
    .describe("Absolute pixels as a number, or a workspace-relative expression such as 50% or 1/2.")
const position = z.object({ x: value, y: value }).strict()
const size = z.object({ width: value, height: value }).strict()
const timeout = z.number().int().positive().optional()

const input = z.discriminatedUnion("action", [
    z.object({ action: z.literal("inspect"), ...coordinates }).strict(),
    z.object({ action: z.literal("move"), ...coordinates, position }).strict(),
    z.object({ action: z.literal("resize"), ...coordinates, size }).strict(),
    z.object({ action: z.literal("setGeometry"), ...coordinates, position, size }).strict(),
    z.object({ action: z.literal("minimize"), ...coordinates, minimized: z.boolean().optional() }).strict(),
    z.object({ action: z.literal("changeTitle"), ...coordinates, title: z.string() }).strict(),
    z.object({ action: z.literal("raise"), ...coordinates }).strict(),
    z.object({
        action: z.literal("wait"),
        ...coordinates,
        event: z.enum(["move", "resize", "geometry", "minimize", "changeTitle", "front"]),
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
        else if (request.action === "changeTitle") await window.changeTitle(request.title)
        else await window.raise()

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

    const [title, position, size, minimized, front, layer, location] = await Promise.all([
        window.title(),
        window.position(),
        window.size(),
        window.minimized(),
        window.front(),
        window.layer(),
        window.location()
    ])

    return Object.freeze({
        process: process.identity,
        title,
        position,
        size,
        minimized,
        front,
        layer,
        location
    })
}
