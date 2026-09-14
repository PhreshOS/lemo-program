import { z } from "zod"
import { tokenSlice } from "../../../token-budget"
import defineTool from "../../define-tool"
import documentation from "./docs.md?raw"

const input = z.object({
    name: z.string().trim().min(1).describe("Exact Tool name returned by tools discovery."),
    offset: z.number().int().nonnegative().optional(),
    tokens: z.number().int().min(256).max(16_000).optional()
})

/** Reads documentation through the invocation's complete Lemo context. */
const docs = defineTool({
    builtin: true,
    order: 1,
    docs: documentation,
    input,
    name: "docs",
    // Documentation is available by name; do not duplicate it in Task history.
    retain: () => null,
    description: "Read documentation for one Runtime tool. Pass its exact name; continue from next as offset.",
    async execute(request, context) {

        const tool = context.tools.find(request.name)

        if (!tool) throw new Error(`Unknown tool "${request.name}"`)

        const offset = request.offset ?? 0
        const page = tokenSlice(tool.docs, request.tokens ?? 2_048, offset)
        return { name: tool.definition.name, docs: page.content, offset, next: page.next, tokens: page.tokens, totalTokens: page.total }
    }
})

export default docs
