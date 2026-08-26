import { z } from "zod"

const key = z.string().trim().min(1).max(64)
const label = z.string().trim().min(1).max(160)
const description = z.string().trim().min(1).max(500).optional()

const option = z.strictObject({
    value: z.string().min(1).max(200),
    label
})

const common = {
    key,
    label,
    description,
    required: z.boolean().optional()
}

const field = z.discriminatedUnion("type", [
    z.strictObject({
        ...common,
        type: z.literal("text"),
        placeholder: z.string().max(300).optional(),
        value: z.string().max(4_000).optional()
    }),
    z.strictObject({
        ...common,
        type: z.literal("textarea"),
        placeholder: z.string().max(300).optional(),
        value: z.string().max(16_000).optional()
    }),
    z.strictObject({
        ...common,
        type: z.literal("number"),
        minimum: z.number().finite().optional(),
        maximum: z.number().finite().optional(),
        step: z.number().finite().positive().optional(),
        value: z.number().finite().optional()
    }).refine(value => value.minimum === undefined || value.maximum === undefined || value.minimum <= value.maximum, {
        message: "A number field's minimum cannot exceed its maximum"
    }),
    z.strictObject({
        ...common,
        type: z.literal("boolean"),
        value: z.boolean().optional()
    }),
    z.strictObject({
        ...common,
        type: z.literal("select"),
        options: z.array(option).min(1).max(100),
        value: z.string().max(200).optional()
    }),
    z.strictObject({
        ...common,
        type: z.literal("multi-select"),
        options: z.array(option).min(1).max(100),
        value: z.array(z.string().max(200)).max(100).optional()
    }),
    z.strictObject({
        ...common,
        type: z.literal("date"),
        value: z.iso.date().optional()
    }),
    z.strictObject({
        ...common,
        type: z.literal("confirmation"),
        value: z.boolean().optional()
    })
])

type PromptField = z.infer<typeof field>

const form = z.strictObject({
    type: z.literal("form"),
    title: z.string().trim().min(1).max(200).optional(),
    content: z.string().trim().min(1).max(4_000).optional(),
    submit: z.string().trim().min(1).max(80).optional(),
    fields: z.array(field).min(1).max(32)
}).superRefine((value, context) => {

    const keys = new Set<string>()

    for (const [index, item] of value.fields.entries()) {
        if (keys.has(item.key)) {
            context.addIssue({
                code: "custom",
                path: ["fields", index, "key"],
                message: `Duplicate field key "${item.key}"`
            })
        }

        keys.add(item.key)
    }
})

const html = z.strictObject({
    type: z.literal("html"),
    title: z.string().trim().min(1).max(200).optional(),
    html: z.string().trim().min(1).max(100_000)
})

const approval = z.strictObject({
    type: z.literal("approval"),
    title: z.string().trim().min(1).max(200),
    content: z.string().trim().min(1).max(4_000)
})

export const interactivePromptRequestSchema = z.discriminatedUnion("type", [form, html])
export const waitAnswerRequestSchema = z.discriminatedUnion("type", [form, html, approval])

export type WaitAnswerRequest = Readonly<z.infer<typeof waitAnswerRequestSchema>>

export type PromptValue = null | boolean | number | string | readonly PromptValue[] | {
    readonly [key: string]: PromptValue
}

export const promptValueSchema: z.ZodType<PromptValue> = z.lazy(() => z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(promptValueSchema),
    z.record(z.string(), promptValueSchema)
]))

export type PromptAnswer = Readonly<{
    type: "submitted"
    values: Readonly<Record<string, PromptValue>>
}> | Readonly<{
    type: "cancelled"
}> | Readonly<{
    type: "approved"
}> | Readonly<{
    type: "rejected"
}>

export function validatePromptAnswer(request: WaitAnswerRequest, answer: PromptAnswer): PromptAnswer {

    if (request.type === "approval") {
        if (answer.type === "approved" || answer.type === "rejected") return answer

        throw new Error("An approval requires an approve or reject response")
    }

    if (answer.type === "approved" || answer.type === "rejected") {
        throw new Error("An interactive prompt cannot receive an approval response")
    }

    if (answer.type === "cancelled") return answer

    const serialized = JSON.stringify(answer.values)

    if (serialized.length > 16_000) throw new Error("Prompt values cannot exceed 16000 characters")

    if (request.type === "html") return answer

    const expected = new Map(request.fields.map(item => [item.key, item]))

    for (const key of Object.keys(answer.values)) {
        if (!expected.has(key)) throw new Error(`Prompt returned unknown field "${key}"`)
    }

    for (const item of request.fields) validateField(item, answer.values[item.key])

    return answer
}

function validateField(field: PromptField, value: PromptValue | undefined) {

    if (value === undefined) {
        if (field.required) throw new Error(`Prompt field "${field.key}" is required`)

        return
    }

    if (field.type === "text" || field.type === "textarea") {
        if (typeof value !== "string" || (field.required && !value.trim())) {
            throw new Error(`Prompt field "${field.key}" must be text`)
        }

        const maximum = field.type === "text" ? 4_000 : 16_000

        if (value.length > maximum) throw new Error(`Prompt field "${field.key}" is too long`)

        return
    }

    if (field.type === "number") {
        if (typeof value !== "number" || !Number.isFinite(value)) {
            throw new Error(`Prompt field "${field.key}" must be a finite number`)
        }

        if (field.minimum !== undefined && value < field.minimum) {
            throw new Error(`Prompt field "${field.key}" is below its minimum`)
        }

        if (field.maximum !== undefined && value > field.maximum) {
            throw new Error(`Prompt field "${field.key}" exceeds its maximum`)
        }

        return
    }

    if (field.type === "boolean") {
        if (typeof value !== "boolean") throw new Error(`Prompt field "${field.key}" must be a boolean`)

        return
    }

    if (field.type === "confirmation") {
        if (typeof value !== "boolean" || (field.required && !value)) {
            throw new Error(`Prompt field "${field.key}" must be confirmed`)
        }

        return
    }

    if (field.type === "date") {
        if (typeof value !== "string" || !z.iso.date().safeParse(value).success) {
            throw new Error(`Prompt field "${field.key}" must be a date`)
        }

        return
    }

    const options = new Set(field.options.map(item => item.value))

    if (field.type === "select") {
        if (typeof value !== "string" || !options.has(value)) {
            throw new Error(`Prompt field "${field.key}" must use one of its options`)
        }

        return
    }

    if (!Array.isArray(value) || value.some(item => typeof item !== "string" || !options.has(item))) {
        throw new Error(`Prompt field "${field.key}" must use only its available options`)
    }

    if (field.required && !value.length) throw new Error(`Prompt field "${field.key}" is required`)
}
