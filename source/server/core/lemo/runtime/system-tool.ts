import {
    systemControl,
    systemControlInputIssue,
    type SystemControlCapabilityName,
    type SystemControlRequest,
    type SystemControlSchema
} from "@phreshos/core"
import { z } from "zod"
import { systemToolPresentation } from "./system-tool-presentation"

type SystemToolInput<Capability extends SystemControlCapabilityName> =
    SystemControlRequest extends infer Request
        ? Request extends Readonly<{ capability: Capability, operation: infer Operation extends string, input: infer Input }>
            ? Input & Readonly<{ action: Operation }>
            : never
        : never

/** Derive an agent-facing System Tool contract and documentation from Core. */
export default function systemTool<Capability extends SystemControlCapabilityName>(capability: Capability) {

    const presentation = systemToolPresentation[capability]

    return Object.freeze({
        description: presentation.description,
        input: z.fromJSONSchema(
            toolSchema(capability) as Parameters<typeof z.fromJSONSchema>[0]
        ).superRefine((input, context) => {

            if (typeof input !== "object" || input === null || !("action" in input)) return

            const issue = systemControlInputIssue(capability, String(input.action), input)

            if (issue) context.addIssue({ code: "custom", message: issue })
        }) as z.ZodType<SystemToolInput<Capability>>,
        docs: documentation(capability)
    })
}

function documentation(capability: SystemControlCapabilityName) {

    const contract = systemControl[capability]
    const presentation = systemToolPresentation[capability]
    const presentedOperations = presentation.operations as Readonly<Record<string, { description: string, examples: readonly Readonly<Record<string, unknown>>[] }>>
    const operations = Object.entries(contract.operations).map(([name, operation]) => [
        `## ${name}`,
        "",
        presentedOperations[name]!.description,
        "",
        `Mode: ${operation.mode}.`,
        "",
        "Input schema:",
        "",
        "```json",
        JSON.stringify(operation.input, null, 2),
        "```",
        "",
        "Examples:",
        "",
        "```json",
        presentedOperations[name]!.examples.map(example => JSON.stringify({ action: name, ...example })).join("\n"),
        "```"
    ].join("\n"))

    return [
        `# ${capability}`,
        "",
        presentation.description,
        "",
        "## Operating guidance",
        "",
        ...presentation.guidance.map(item => `- ${item}`),
        "",
        ...operations
    ].join("\n")
}

function toolSchema(capability: SystemControlCapabilityName): SystemControlSchema {

    const operations = systemControl[capability].operations

    return {
        oneOf: Object.entries(operations).flatMap(([name, definition]) => (
            definition.input.oneOf ?? [definition.input]
        ).map(input => ({
            ...input,
            properties: { action: { type: "string", const: name }, ...input.properties },
            required: ["action", ...(input.required ?? [])]
        })))
    }
}
