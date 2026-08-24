import { z } from "zod"
import type Tool from "../../tool"
import docs from "./docs.md?raw"

const input = z.object({
    content: z.string().trim().min(1).max(4_000)
}).strict()

/** Waits for the Client's first response to one user-facing prompt. */
const prompt: Tool = {
    docs,
    definition: Object.freeze({
        name: "prompt",
        description: "Present a prompt to the user in this Task and wait for their response.",
        parameters: Object.freeze({
            type: "object",
            properties: Object.freeze({
                content: Object.freeze({ type: "string", description: "Prompt shown to the user" })
            }),
            required: Object.freeze(["content"]),
            additionalProperties: false
        })
    }),
    async execute(value, context) {

        const request = input.parse(value)

        return Object.freeze({ answer: await context.waitAnswer(request) })
    }
}

export default prompt
