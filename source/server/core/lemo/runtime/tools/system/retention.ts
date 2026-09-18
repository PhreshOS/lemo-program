import type { ExecuteRequest } from "@phreshos/core"

/** Selects the System result that remains in a Task's durable working context. */
export default function retainSystemResult(output: unknown, request: ExecuteRequest): unknown {

    if (request.$domain === "program" && request.$operation === "agent") return null

    const bounded = (request.$domain === "endpoint" && request.$operation === "ask")
        || (request.$domain === "program" && request.$operation === "logs")

    if (!bounded) return output

    const compact = compactValue(output)
    const serialized = JSON.stringify(compact)

    if (serialized.length <= 24_000) return compact

    return Object.freeze({
        kind: request.$domain === "program" ? "large-program-logs-result" : "large-endpoint-result",
        originalCharacters: JSON.stringify(output).length,
        contextCharacters: serialized.length,
        preview: serialized.slice(0, 16_000),
        note: "Retained text excerpt; request a narrower result for additional details."
    })
}

function compactValue(value: unknown, key = ""): unknown {

    if (typeof value === "string") {

        if (/^(?:image|screenshot|frame|blob|base64|data)$/i.test(key) && value.length > 256) {
            return Object.freeze({
                kind: "binary",
                characters: value.length,
                note: "Only binary content metadata is retained."
            })
        }

        if (value.length > 8_000) return `${value.slice(0, 6_000)}\n[${value.length - 6_000} characters omitted]`

        return value
    }

    if (Array.isArray(value)) {
        return value.length <= 40
            ? value.map(item => compactValue(item))
            : Object.freeze({
                items: value.slice(0, 40).map(item => compactValue(item)),
                omittedItems: value.length - 40
            })
    }

    if (typeof value !== "object" || value === null) return value

    const entries = Object.entries(value)
    const compact = Object.fromEntries(entries.slice(0, 60).map(([name, item]) => [
        name,
        compactValue(item, name)
    ])) as Record<string, unknown>

    if (entries.length > 60) compact.omittedProperties = entries.length - 60

    return Object.freeze(compact)
}
