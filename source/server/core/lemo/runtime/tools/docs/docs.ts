import { z } from "zod"
import type Tool from "../../tool"
import documentation from "./docs.md?raw"

const input = z.object({ name: z.string().trim().min(1) }).strict()

/** Creates Runtime's tool-documentation discovery capability. */
export default function docs(catalog: () => readonly Tool[]): Tool {

    return {
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
        async execute(value) {

            const request = input.parse(value)

            const tool = catalog().find(candidate => candidate.definition.name === request.name)

            if (!tool) throw new Error(`Unknown tool "${request.name}"`)

            return { name: tool.definition.name, docs: tool.docs }
        }
    }
}
