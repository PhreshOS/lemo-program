import {
    systemControl,
    systemControlInputIssue,
    systemControlToolSchema,
    type SystemControlCapabilityName,
    type SystemControlToolInput
} from "@phreshos/core"
import { z } from "zod"

/** Derive an agent-facing System Tool contract and documentation from Core. */
export default function systemTool<Capability extends SystemControlCapabilityName>(capability: Capability) {

    const definition = systemControl[capability]

    return Object.freeze({
        description: definition.description,
        input: z.fromJSONSchema(
            systemControlToolSchema(capability) as Parameters<typeof z.fromJSONSchema>[0]
        ).superRefine((input, context) => {

            if (typeof input !== "object" || input === null || !("action" in input)) return

            const issue = systemControlInputIssue(capability, String(input.action), input)

            if (issue) context.addIssue({ code: "custom", message: issue })
        }) as z.ZodType<SystemControlToolInput<Capability>>,
        docs: documentation(capability)
    })
}

function documentation(capability: SystemControlCapabilityName) {

    const definition = systemControl[capability]
    const operations = Object.entries(definition.operations).map(([name, operation]) => [
        `## ${name}`,
        "",
        operation.description,
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
        operation.examples.map(example => JSON.stringify({ action: name, ...example })).join("\n"),
        "```"
    ].join("\n"))

    return [
        `# ${capability}`,
        "",
        definition.description,
        "",
        "## Operating guidance",
        "",
        ...definition.guidance.map(item => `- ${item}`),
        "",
        ...operations
    ].join("\n")
}
