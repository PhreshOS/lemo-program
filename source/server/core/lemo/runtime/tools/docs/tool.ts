import { z } from "zod"
import defineTool from "../../define-tool"
import documentation from "./docs.md?raw"

const input = z.object({
    name: z.string().trim().min(1).describe("Exact Tool name returned by tools discovery.")
}).strict()

/** Reads documentation through the invocation's complete Lemo context. */
const docs = defineTool({
    builtin: true,
    order: 1,
    docs: documentation,
    input,
    name: "docs",
    description: "Read the complete documentation for one Runtime tool. Pass its exact name.",
    async execute(request, context) {

        const tool = context.tools.find(request.name)

        if (!tool) throw new Error(`Unknown tool "${request.name}"`)

        return { name: tool.definition.name, docs: tool.docs }
    }
})

export default docs
