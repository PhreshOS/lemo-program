import type Operation from "@server/core/lemo/operation"

/** Validates one authoritative operation entering the Client projection. */
export default function operation(value: unknown): Operation {

    if (!record(value)) throw new Error("The Server returned an invalid Lemo operation")

    const sequence = value.sequence
    const id = text(value.id)
    const task = nullableText(value.task)
    const parent = nullableText(value.parent)
    const kind = text(value.kind)
    const createdAt = value.createdAt

    if (
        typeof sequence !== "number"
        || !id
        || (value.task !== null && !task)
        || (value.parent !== null && !parent)
        || !kind
        || typeof createdAt !== "number"
    ) throw new Error("The Server returned an incomplete Lemo operation")

    return Object.freeze({ sequence, id, task, parent, kind, payload: value.payload, createdAt })
}

export function taskOperation(value: unknown): Operation & Readonly<{ task: string }> {

    const parsed = operation(value)

    if (!parsed.task) throw new Error("The Server returned a non-Task Lemo operation")

    return parsed as Operation & Readonly<{ task: string }>
}

function nullableText(value: unknown) {

    return value === null ? null : text(value)
}

function text(value: unknown) {

    return typeof value === "string" ? value.trim() : ""
}

function record(value: unknown): value is Record<string, unknown> {

    return typeof value === "object" && value !== null && !Array.isArray(value)
}
