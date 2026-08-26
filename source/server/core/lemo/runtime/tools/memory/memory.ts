import { z } from "zod"
import {
    defaultMemoryBudget,
    maximumMemoryBudget,
    minimumMemoryBudget
} from "../../../memory"
import defineTool from "../../define-tool"
import docs from "./docs.md?raw"

const input = z.object({
    query: z.string().trim().min(1).describe("Required semantic query describing the context to recall."),
    budget: z.number().int().min(minimumMemoryBudget).max(maximumMemoryBudget).optional()
}).strict()

/** Recalls Memory through the invocation's complete Lemo context. */
const memory = defineTool({
    builtin: true,
    order: 2,
    docs,
    input,
    name: "memory",
    description: "Recall related durable context from Lemo's shared history. A query is always required.",
    async execute(request, context) {

        const results = await context.memory.recall(request)

        await context.invocation.record("recalled", {
            query: request.query,
            budget: request.budget ?? defaultMemoryBudget,
            operations: results.map(result => result.operation)
        })

        return results
    }
})

export default memory
