import { z } from "zod"
import defineTool from "../../define-tool"
import docs from "./docs.md?raw"

const input = z.object({
    names: z.array(z.string().trim().min(1)).optional()
        .describe("Exact Tool names to load. This does not invoke those Tools."),
    all: z.boolean().optional().describe("Load every ordinary Tool when true.")
}).strict().refine(value => value.all === true || Boolean(value.names?.length), {
    message: "Choose tool names or request all tools"
})

/** Discovers tools through the invocation's complete Lemo context. */
const tools = defineTool({
    builtin: true,
    order: 0,
    docs,
    input,
    name: "tools",
    description: "Discover and load Runtime tools for later Model cycles; never pass another Tool's input here.",
    async execute(request, context) {

        const available = context.tools.list().filter(tool => !tool.builtin)

        const selected = request.all
            ? available
            : request.names!.map(name => {

                const tool = available.find(candidate => candidate.definition.name === name)

                if (!tool) throw new Error(`Unknown tool "${name}"`)

                return tool
            })

        const names = [...new Set(selected.map(tool => tool.definition.name))]

        await context.tools.load(names)

        return selected.map(tool => tool.definition)
    }
})

export default tools
