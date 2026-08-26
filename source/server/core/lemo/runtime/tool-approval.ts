import type { LLMToolDefinition } from "../../llm/model"
import type { ToolApproval } from "./tool"

const approval = Object.freeze({
    type: "boolean",
    description: "When true, wait for the user's approval before executing this Tool invocation."
})

/** Derives a flat, approval-aware Tool schema from one ordinary object schema. */
export function approvalParameters(parameters: Readonly<Record<string, unknown>>) {

    return withApproval(parameters)
}

function withApproval(schema: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {

    for (const keyword of ["oneOf", "anyOf"] as const) {
        if (!Array.isArray(schema[keyword])) continue

        return Object.freeze({
            ...schema,
            [keyword]: Object.freeze(schema[keyword].map(branch => withApproval(object(branch))))
        })
    }

    if (schema.type !== "object") throw new Error("Every Tool input schema must describe an object")

    const properties = object(schema.properties)

    if ("approval" in properties) throw new Error("Tool input cannot declare Runtime's reserved approval property")

    return Object.freeze({
        ...schema,
        properties: Object.freeze({ ...properties, approval })
    })
}

function object(value: unknown): Readonly<Record<string, unknown>> {

    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error("A Tool schema contains an invalid object branch")
    }

    return value as Readonly<Record<string, unknown>>
}

export function approvalDefinition(
    name: string,
    description: string,
    parameters: Readonly<Record<string, unknown>>
): LLMToolDefinition {

    return Object.freeze({ name, description, parameters: approvalParameters(parameters) })
}

export function defaultApproval(name: string, input: unknown): ToolApproval {

    let content: string

    try {
        content = JSON.stringify(input, null, 2) ?? String(input)
    } catch {
        content = String(input)
    }

    if (content.length > 3_500) content = `${content.slice(0, 3_497)}...`

    return Object.freeze({
        title: `Approve ${name}`,
        content: `Lemo wants to invoke the ${name} Tool with this input:\n\n${content}`
    })
}
