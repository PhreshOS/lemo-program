/** Normalizes only JSON-encoded values whose declared Tool schema requires another JSON type. */
export default function toolInput(value: unknown, schema: unknown): unknown {

    const definition = record(schema)

    if (!definition) return value

    const branch = selectBranch(value, definition.oneOf)

    if (branch) return toolInput(value, branch)

    const type = definition.type

    if (type === "object") {

        const decoded = encoded(value, isRecord)

        if (!isRecord(decoded)) return value

        const properties = record(definition.properties)

        if (!properties) return decoded

        return Object.fromEntries(Object.entries(decoded).map(([name, item]) => [
            name,
            name in properties ? toolInput(item, properties[name]) : item
        ]))
    }

    if (type === "array") {

        const decoded = encoded(value, Array.isArray)

        if (!Array.isArray(decoded)) return value

        return Array.isArray(definition.items)
            ? decoded
            : decoded.map(item => toolInput(item, definition.items))
    }

    if (type === "boolean" && value === "true") return true

    if (type === "boolean" && value === "false") return false

    if ((type === "number" || type === "integer") && numeric(value)) return Number(value)

    return value
}

function selectBranch(value: unknown, oneOf: unknown) {

    if (!Array.isArray(oneOf)) return null

    const decoded = decode(value)

    for (const candidate of oneOf) {

        const branch = record(candidate)

        if (!branch) continue

        const properties = record(branch.properties)

        if (!properties || !isRecord(decoded)) continue

        const constants = Object.entries(properties).filter(([, property]) => record(property)?.const !== undefined)

        if (constants.length && constants.every(([name, property]) => decoded[name] === record(property)?.const)) {

            return branch
        }
    }

    return oneOf.map(record).find(candidate => candidate && accepts(decoded, candidate)) ?? null
}

function accepts(value: unknown, schema: Record<string, unknown>) {

    if (schema.type === "object") return isRecord(value)

    if (schema.type === "array") return Array.isArray(value)

    if (schema.type === "boolean") return typeof value === "boolean"

    if (schema.type === "number" || schema.type === "integer") return typeof value === "number"

    if (schema.type === "string") return typeof value === "string"

    return false
}

function encoded(value: unknown, accept: (value: unknown) => boolean) {

    if (accept(value) || typeof value !== "string") return value

    const decoded = decode(value)

    return accept(decoded) ? decoded : value
}

function decode(value: unknown) {

    if (typeof value !== "string") return value

    try {
        return JSON.parse(value) as unknown
    } catch {
        return value
    }
}

function numeric(value: unknown): value is string {

    return typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))
}

function isRecord(value: unknown): value is Record<string, unknown> {

    return typeof value === "object" && value !== null && !Array.isArray(value)
}

function record(value: unknown) {

    return isRecord(value) ? value : null
}
