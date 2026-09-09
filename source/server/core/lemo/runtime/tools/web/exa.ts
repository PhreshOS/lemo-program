import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js"
import manifest from "../../../../../../../package.json"
import type { WebRequest, WebResult } from "./contract"

/** Exa owns search and extraction; Lemo retains the returned text without reparsing its format. */
export default async function exa(request: WebRequest, parent: AbortSignal): Promise<WebResult> {

    const signal = AbortSignal.any([parent, AbortSignal.timeout(45_000)])

    signal.throwIfAborted()

    const client = new Client({ name: manifest.name, version: manifest.version })
    const transport = new StreamableHTTPClientTransport(
        new URL("https://mcp.exa.ai/mcp?tools=web_search_exa,web_fetch_exa"),
        {
            fetch: (url, options) => fetch(url, {
                ...options,
                signal: AbortSignal.any([signal, ...(options?.signal ? [options.signal] : [])])
            })
        }
    )

    try {
        await client.connect(transport, { signal, timeout: 45_000 })

        const result = CallToolResultSchema.parse(await client.callTool(request.action === "search" ? {
            name: "web_search_exa",
            arguments: { query: request.query, numResults: request.count }
        } : {
            name: "web_fetch_exa",
            arguments: { urls: [request.url], maxCharacters: request.maxCharacters }
        }, CallToolResultSchema, { signal, timeout: 45_000 }))

        signal.throwIfAborted()

        const content = result.content.map(block => {

            if (block.type !== "text") throw new Error("Exa returned unsupported non-text content")

            return block.text
        }).join("\n\n")

        if (result.isError) throw new Error(`Exa: ${content || "Web operation failed"}`)
        if (!content.trim()) throw new Error("Exa returned no content")

        return Object.freeze({ request, provider: "exa", content })
    } finally {
        await client.close()
    }
}
