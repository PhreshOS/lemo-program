import { z } from "zod"
import type Tool from "./tool"
import type { ToolApproval, ToolContext } from "./tool"
import { approvalDefinition } from "./tool-approval"
import toolInput from "./tool-input"

type ToolOptions<Schema extends z.ZodType> = Readonly<{
    name: string
    description: string
    input: Schema
    docs: string
    builtin?: boolean
    order?: number
    approval?(input: z.output<Schema>): ToolApproval | null | Promise<ToolApproval | null>
    execute(input: z.output<Schema>, context: ToolContext): Promise<unknown>
    modelOutput?(output: unknown): unknown
}>

/** Defines one Tool from its sole Zod input contract and Runtime's approval template. */
export default function defineTool<Schema extends z.ZodType>(options: ToolOptions<Schema>): Tool {

    const definition = approvalDefinition(
        options.name,
        options.description,
        jsonSchema(options.input)
    )

    const tool: Tool = {
        definition,
        docs: options.docs,
        builtin: options.builtin,
        order: options.order,
        parse(value: unknown) {

            const normalized = toolInput(value, definition.parameters)
            const candidate = record(normalized)
            const requested = candidate?.approval === true
            const ordinary = candidate && "approval" in candidate
                ? Object.fromEntries(Object.entries(candidate).filter(([name]) => name !== "approval"))
                : normalized

            return Object.freeze({ input: options.input.parse(ordinary), approval: requested })
        },
        approval: options.approval
            ? (input: unknown) => options.approval!(input as z.output<Schema>)
            : undefined,
        execute: (input: unknown, context: ToolContext) => options.execute(input as z.output<Schema>, context),
        modelOutput: options.modelOutput
    }

    return Object.freeze(tool)
}

function jsonSchema(schema: z.ZodType): Readonly<Record<string, unknown>> {

    const generated = z.toJSONSchema(schema, {
        target: "draft-07",
        unrepresentable: "any"
    }) as Readonly<Record<string, unknown>>

    const parameters = Object.fromEntries(
        Object.entries(generated).filter(([name]) => name !== "$schema" && name !== "~standard")
    )

    return Object.freeze(parameters)
}

function record(value: unknown) {

    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null
}
