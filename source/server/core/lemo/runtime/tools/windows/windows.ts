import { host, type Process, type Window } from "@phreshos/server"
import { z } from "zod"
import type Tool from "../../tool"
import waitEvent from "../../wait-event"
import docs from "./docs.md?raw"

const value = z.union([z.number().finite(), z.string().trim().min(1)])

const position = z.object({ x: value, y: value }).strict()

const size = z.object({ width: value, height: value }).strict()

const coordinates = {
    process: z.string().trim().min(1),
    program: z.string().trim().min(1).optional()
}

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
        timeout: z.number().int().positive().optional()
    }).strict()
])

const coordinateParameters = Object.freeze({
    process: Object.freeze({ type: "string" }),
    program: Object.freeze({ type: "string" })
})

const valueParameters = Object.freeze({
    oneOf: Object.freeze([
        Object.freeze({
            type: "number",
            description: "An absolute pixel count. Decimals remain pixels: 0.5 means half a pixel, not half the workspace."
        }),
        Object.freeze({
            type: "string",
            description: "A linear expression. Use a percentage such as \"50%\" or fraction such as \"1/2\" for a workspace-relative value; a plain numeric string is still pixels."
        })
    ])
})

const positionParameters = Object.freeze({
    type: "object",
    required: Object.freeze(["x", "y"]),
    properties: Object.freeze({ x: valueParameters, y: valueParameters }),
    additionalProperties: false
})

const sizeParameters = Object.freeze({
    type: "object",
    required: Object.freeze(["width", "height"]),
    properties: Object.freeze({ width: valueParameters, height: valueParameters }),
    additionalProperties: false
})

/** Reads and controls the authoritative Window of one live Client Endpoint. */
const windows: Tool = {
    docs,
    definition: Object.freeze({
        name: "windows",
        description: "Inspect or change a live Client Window. Geometry numbers are pixels, never proportions; use strings such as \"50%\" or \"1/2\" for workspace-relative dimensions.",
        parameters: Object.freeze({
            oneOf: Object.freeze([
                variant("inspect"),
                variant("move", { position: positionParameters }),
                variant("resize", { size: sizeParameters }),
                variant("setGeometry", { position: positionParameters, size: sizeParameters }),
                variant("minimize", { minimized: Object.freeze({ type: "boolean", default: true }) }),
                variant("changeTitle", { title: Object.freeze({ type: "string" }) }),
                variant("raise"),
                variant("wait", {
                    event: Object.freeze({
                        type: "string",
                        enum: Object.freeze(["move", "resize", "geometry", "minimize", "changeTitle", "front"])
                    }),
                    timeout: Object.freeze({ type: "integer", minimum: 1 })
                })
            ])
        })
    }),
    async execute(value, context) {

        const request = input.parse(value)

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
}

export default windows

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

function variant(action: string, extra: Readonly<Record<string, unknown>> = {}) {

    return Object.freeze({
        type: "object",
        required: Object.freeze([
            "action",
            "process",
            ...Object.keys(extra).filter(key => key !== "minimized" && key !== "timeout")
        ]),
        properties: Object.freeze({
            action: Object.freeze({ const: action }),
            ...coordinateParameters,
            ...extra
        }),
        additionalProperties: false
    })
}
