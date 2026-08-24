import { z } from "zod"
import type Memory from "../../../memory"
import {
    defaultMemoryBudget,
    maximumMemoryBudget,
    minimumMemoryBudget
} from "../../../memory"
import type Tool from "../../tool"
import docs from "./docs.md?raw"

const input = z.object({
    query: z.string().trim().min(1),
    budget: z.number().int().min(minimumMemoryBudget).max(maximumMemoryBudget).optional()
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
                    budget: Object.freeze({
                        type: "integer",
                        minimum: minimumMemoryBudget,
                        maximum: maximumMemoryBudget
                    })
                }),
                additionalProperties: false
            })
        }),
        async execute(value, context) {

            const request = input.parse(value)

            const results = await memory.recall(request)

            await context.record("recalled", {
                query: request.query,
                budget: request.budget ?? defaultMemoryBudget,
                operations: results.map(result => result.operation)
            })

            return results
        }
    }
}
