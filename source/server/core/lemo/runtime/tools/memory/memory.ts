import { z } from "zod"
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

/** Recalls Memory through the invocation's complete Lemo context. */
const memory: Tool = {
    builtin: true,
    order: 2,
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

        const results = await context.memory.recall(request)

        await context.invocation.record("recalled", {
            query: request.query,
            budget: request.budget ?? defaultMemoryBudget,
            operations: results.map(result => result.operation)
        })

        return results
    }
}

export default memory
