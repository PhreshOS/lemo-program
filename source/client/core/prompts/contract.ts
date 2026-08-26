import { z } from "zod"

export type PromptEvent =
    | "lemo.prompt.open"
    | "lemo.prompt.release"
    | "lemo.prompt.invalid"
    | "lemo.prompt.response"
    | "lemo.prompt.ready"

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

export const promptFieldSchema = z.discriminatedUnion("type", [
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

export const promptRequestSchema = z.discriminatedUnion("type", [
    z.strictObject({
        type: z.literal("form"),
        title: z.string().trim().min(1).max(200).optional(),
        content: z.string().trim().min(1).max(4_000).optional(),
        submit: z.string().trim().min(1).max(80).optional(),
        fields: z.array(promptFieldSchema).min(1).max(32)
    }).superRefine((value, context) => {

        const keys = new Set<string>()

        for (const [index, field] of value.fields.entries()) {
            if (keys.has(field.key)) {
                context.addIssue({
                    code: "custom",
                    path: ["fields", index, "key"],
                    message: `Duplicate field key "${field.key}"`
                })
            }

            keys.add(field.key)
        }
    }),
    z.strictObject({
        type: z.literal("html"),
        title: z.string().trim().min(1).max(200).optional(),
        html: z.string().trim().min(1).max(100_000)
    }),
    z.strictObject({
        type: z.literal("approval"),
        title: z.string().trim().min(1).max(200),
        content: z.string().trim().min(1).max(4_000)
    })
])

export type PromptValue = null | boolean | number | string | readonly PromptValue[] | {
    readonly [key: string]: PromptValue
}

const promptValueSchema: z.ZodType<PromptValue> = z.lazy(() => z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(promptValueSchema),
    z.record(z.string(), promptValueSchema)
]))

export const promptRecordSchema = z.strictObject({
    id: z.string().trim().min(1),
    task: z.string().trim().min(1),
    call: z.string().trim().min(1),
    request: promptRequestSchema,
    createdAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().nonnegative()
})

export const promptReleaseSchema = z.strictObject({
    id: z.string().trim().min(1),
    reason: z.enum(["answered", "timeout", "cancelled", "failed"])
})

export const promptInvalidSchema = z.strictObject({
    id: z.string().trim().min(1),
    error: z.string().trim().min(1).max(1_000)
})

export const promptResponseSchema = z.discriminatedUnion("type", [
    z.strictObject({
        id: z.string().trim().min(1),
        type: z.literal("submitted"),
        values: z.record(z.string().trim().min(1).max(64), promptValueSchema)
    }),
    z.strictObject({
        id: z.string().trim().min(1),
        type: z.literal("cancelled")
    }),
    z.strictObject({
        id: z.string().trim().min(1),
        type: z.literal("failed"),
        error: z.string().trim().min(1).max(1_000)
    }),
    z.strictObject({ id: z.string().trim().min(1), type: z.literal("approved") }),
    z.strictObject({ id: z.string().trim().min(1), type: z.literal("rejected") })
])

export type PromptField = Readonly<z.infer<typeof promptFieldSchema>>
export type PromptRequest = Readonly<z.infer<typeof promptRequestSchema>>
export type PromptRecord = Readonly<z.infer<typeof promptRecordSchema>>
export type PromptRelease = Readonly<z.infer<typeof promptReleaseSchema>>
export type PromptInvalid = Readonly<z.infer<typeof promptInvalidSchema>>
export type PromptResponse = Readonly<z.infer<typeof promptResponseSchema>>

export function validatePromptValues(request: PromptRequest, values: Readonly<Record<string, PromptValue>>) {

    if (request.type === "approval") throw new Error("An approval does not accept form values")

    const serialized = JSON.stringify(values)

    if (serialized.length > 16_000) throw new Error("Prompt values cannot exceed 16000 characters")
    if (request.type === "html") return

    const expected = new Map(request.fields.map(field => [field.key, field]))

    for (const key of Object.keys(values)) {
        if (!expected.has(key)) throw new Error(`Prompt returned unknown field "${key}"`)
    }

    for (const field of request.fields) validateField(field, values[field.key])
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

    const options = new Set(field.options.map(option => option.value))

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
