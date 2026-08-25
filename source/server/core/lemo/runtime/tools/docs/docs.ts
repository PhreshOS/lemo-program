import { z } from "zod"
import type Tool from "../../tool"
import documentation from "./docs.md?raw"

const input = z.object({ name: z.string().trim().min(1) }).strict()

/** Reads documentation through the invocation's complete Lemo context. */
const docs: Tool = {
    builtin: true,
    order: 1,
    docs: documentation,
    definition: Object.freeze({
        name: "docs",
        description: "Read the complete documentation for one Runtime tool.",
        parameters: Object.freeze({
            type: "object",
            required: Object.freeze(["name"]),
            properties: Object.freeze({ name: Object.freeze({ type: "string" }) }),
            additionalProperties: false
        })
    }),
    async execute(value, context) {

        const request = input.parse(value)

        const tool = context.tools.find(request.name)

        if (!tool) throw new Error(`Unknown tool "${request.name}"`)

        return { name: tool.definition.name, docs: tool.docs }
    }
}

export default docs
