import { z } from "zod"
import type Memory from "../../../memory"
import type Tool from "../../tool"
import docs from "./docs.md?raw"

const input = z.object({
    query: z.string().trim().min(1),
    limit: z.number().int().min(1).max(20).optional()
}).strict()

/** Creates Runtime's initially available access to Lemo's internal Memory. */
export default function memory(memory: Memory): Tool {

    return {
        docs,
        definition: Object.freeze({
            name: "memory",
            description: "Recall related durable context from Lemo's shared history.",
            parameters: Object.freeze({
                type: "object",
                required: Object.freeze(["query"]),
                properties: Object.freeze({
                    query: Object.freeze({ type: "string" }),
                    limit: Object.freeze({ type: "integer", minimum: 1, maximum: 20 })
                }),
                additionalProperties: false
            })
        }),
        async execute(value, context) {

            const request = input.parse(value)

            const results = await memory.recall(request)

            await context.record("recalled", {
                query: request.query,
                limit: request.limit ?? 20,
                operations: results.map(result => result.operation)
            })

            return results
        }
    }
}
