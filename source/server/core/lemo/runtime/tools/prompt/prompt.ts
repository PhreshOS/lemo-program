import type Tool from "../../tool"
import { waitAnswerRequestSchema } from "../../prompt-contract"
import docs from "./docs.md?raw"

const option = Object.freeze({
    type: "object",
    properties: Object.freeze({
        value: Object.freeze({ type: "string" }),
        label: Object.freeze({ type: "string" })
    }),
    required: Object.freeze(["value", "label"]),
    additionalProperties: false
})

const field = Object.freeze({
    type: "object",
    description: "A text, textarea, number, boolean, select, multi-select, date, or confirmation field.",
    properties: Object.freeze({
        type: Object.freeze({
            type: "string",
            enum: Object.freeze([
                "text",
                "textarea",
                "number",
                "boolean",
                "select",
                "multi-select",
                "date",
                "confirmation"
            ])
        }),
        key: Object.freeze({ type: "string", description: "Unique result key" }),
        label: Object.freeze({ type: "string" }),
        description: Object.freeze({ type: "string" }),
        required: Object.freeze({ type: "boolean" }),
        placeholder: Object.freeze({ type: "string", description: "Only for text and textarea" }),
        value: Object.freeze({ description: "Optional initial value matching the field type" }),
        minimum: Object.freeze({ type: "number", description: "Only for number" }),
        maximum: Object.freeze({ type: "number", description: "Only for number" }),
        step: Object.freeze({ type: "number", description: "Positive number; only for number" }),
        options: Object.freeze({
            type: "array",
            description: "Required only for select and multi-select",
            items: option
        })
    }),
    required: Object.freeze(["type", "key", "label"]),
    additionalProperties: false
})

/** Waits for the Client's first response to one user-facing form or HTML prompt. */
const prompt: Tool = {
    docs,
    definition: Object.freeze({
        name: "prompt",
        description: "Present a structured form or interactive HTML document to the user and wait for its result.",
        parameters: Object.freeze({
            oneOf: Object.freeze([
                Object.freeze({
                    type: "object",
                    properties: Object.freeze({
                        type: Object.freeze({ const: "form" }),
                        title: Object.freeze({ type: "string" }),
                        content: Object.freeze({ type: "string" }),
                        submit: Object.freeze({ type: "string", description: "Optional submit button label" }),
                        fields: Object.freeze({ type: "array", minItems: 1, items: field })
                    }),
                    required: Object.freeze(["type", "fields"]),
                    additionalProperties: false
                }),
                Object.freeze({
                    type: "object",
                    properties: Object.freeze({
                        type: Object.freeze({ const: "html" }),
                        title: Object.freeze({ type: "string" }),
                        html: Object.freeze({
                            type: "string",
                            description: "Complete interactive HTML. Use form.set(key, value) and form.submit()."
                        })
                    }),
                    required: Object.freeze(["type", "html"]),
                    additionalProperties: false
                })
            ])
        })
    }),
    async execute(value, context) {

        return await context.client.waitAnswer(waitAnswerRequestSchema.parse(value))
    }
}

export default prompt
