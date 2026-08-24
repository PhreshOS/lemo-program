import { z } from "zod"
import type Tool from "../../tool"
import docs from "./docs.md?raw"

const input = z.object({
    names: z.array(z.string().trim().min(1)).optional(),
    all: z.boolean().optional()
}).strict().refine(value => value.all === true || Boolean(value.names?.length), {
    message: "Choose tool names or request all tools"
})

/** Creates Runtime's tool-discovery capability over its authoritative catalog. */
export default function tools(catalog: () => readonly Tool[]): Tool {

    return {
        docs,
        definition: Object.freeze({
            name: "tools",
            description: "Discover and load available Runtime tools for later Model cycles.",
            parameters: Object.freeze({
                type: "object",
                properties: Object.freeze({
                    names: Object.freeze({ type: "array", items: Object.freeze({ type: "string" }) }),
                    all: Object.freeze({ type: "boolean" })
                }),
                additionalProperties: false
            })
        }),
        async execute(value, context) {

            const request = input.parse(value)

            const available = catalog().filter(tool => !builtIn.has(tool.definition.name))

            const selected = request.all
                ? available
                : request.names!.map(name => {

                    const tool = available.find(candidate => candidate.definition.name === name)

                    if (!tool) throw new Error(`Unknown tool "${name}"`)

                    return tool
                })

            const names = [...new Set(selected.map(tool => tool.definition.name))]

            await context.record("loaded", { names })

            return selected.map(tool => tool.definition)
        }
    }
}

const builtIn = new Set(["tools", "docs", "memory"])
