import assert from "node:assert/strict"
import { estimatedTokens } from "../source/server/core/lemo/token-budget"
import type { ToolContext } from "../source/server/core/lemo/runtime/tool"
import { webResult } from "../source/server/core/lemo/runtime/tools/web/contract"
import web from "../source/server/core/lemo/runtime/tools/web/tool"
import { test } from "vitest"

test("web contract", async () => {
  const originalFetch = globalThis.fetch
  const calls: Record<string, unknown>[] = []
  const signals: AbortSignal[] = []
  let response: unknown = { content: [{ type: "text", text: "Title: Example\nURL: https://example.com\nHighlights:\nA source excerpt." }] }
  let mode: "json" | "sse" | "rate-limit" | "wait-call" | "wait-initialize" = "json"

  globalThis.fetch = async (input, options) => {

      assert.equal(String(input), "https://mcp.exa.ai/mcp?tools=web_search_exa,web_fetch_exa")
      assert(options?.signal)
      signals.push(options.signal)

      if (options.method === "GET") return new Response(null, { status: 405 })

      assert.equal(options.method, "POST")
      const message = JSON.parse(String(options.body)) as Record<string, unknown>
      calls.push(message)

      if (message.method === "initialize") {
          if (mode === "wait-initialize") return wait(options.signal)

          return json(message.id, {
              protocolVersion: "2025-03-26",
              capabilities: { tools: {} },
              serverInfo: { name: "web-fixture", version: "1.0.0" }
          })
      }

      if (message.method === "notifications/initialized" || message.method === "notifications/cancelled") {
          return new Response(null, { status: 202 })
      }

      assert.equal(message.method, "tools/call")

      if (mode === "wait-call") return wait(options.signal)
      if (mode === "rate-limit") return new Response("Rate limit exceeded", { status: 429 })
      if (mode === "sse") {
          const bytes = new TextEncoder().encode(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: message.id, result: response })}\n\n`)

          return new Response(new ReadableStream({
              start(controller) {
                  for (let offset = 0; offset < bytes.length; offset += 7) controller.enqueue(bytes.slice(offset, offset + 7))
                  controller.close()
              }
          }), { headers: { "Content-Type": "text/event-stream" } })
      }

      return json(message.id, response)
  }

  try {
      assert.equal(web.definition.name, "web")
      assert.equal(web.builtin, undefined)
      assert.equal(web.observation?.({ action: "search", query: "example" }), true)

      assert.deepEqual(web.parse({ action: "search", query: " example " }), {
          approval: false,
          input: { action: "search", query: "example", count: 5 }
      })
      assert.deepEqual(web.parse({ action: "read", url: "https://example.com", approval: true }), {
          approval: true,
          input: { action: "read", url: "https://example.com", maxCharacters: 20_000 }
      })

      for (const input of [
          {},
          { action: "fetch", url: "https://example.com" },
          { action: "search", query: " " },
          { action: "search", query: "x".repeat(4001) },
          { action: "search", query: "example", count: 0 },
          { action: "search", query: "example", count: 11 },
          { action: "search", query: "example", count: 1.5 },
          { action: "search", query: "example", url: "https://example.com" },
          { action: "read", url: "https://example.com", query: "example" },
          { action: "read", url: "file:///etc/hosts" },
          { action: "read", url: "javascript:alert(1)" },
          { action: "read", url: "ftp://example.com" },
          { action: "read", url: "/relative" },
          { action: "read", url: "https://user:secret@example.com" },
          { action: "read", url: "https://example.com", maxCharacters: 100_001 }
      ]) assert.throws(() => web.parse(input))

      const search = await execute({ action: "search", query: "example" })

      assert.deepEqual(search, {
          provider: "exa",
          request: { action: "search", query: "example", count: 5 },
          content: "Title: Example\nURL: https://example.com\nHighlights:\nA source excerpt."
      })
      assert.deepEqual(lastCall(), { name: "web_search_exa", arguments: { query: "example", numResults: 5 } })
      assert(signals.every(signal => signal.aborted), "Every invocation must close its transport")

      mode = "sse"
      response = { content: [{ type: "text", text: "# Example 🌍\nURL: https://example.com" }, { type: "text", text: "A readable page." }] }
      const read = await execute({ action: "read", url: "https://example.com", maxCharacters: 40_000 })

      assert.equal(read.content, "# Example 🌍\nURL: https://example.com\n\nA readable page.")
      assert.deepEqual(lastCall(), { name: "web_fetch_exa", arguments: { urls: ["https://example.com"], maxCharacters: 40_000 } })

      response = { content: [{ type: "text", text: "No search results found." }] }
      assert.equal((await execute({ action: "search", query: "absent" })).content, "No search results found.")

      response = { content: [{ type: "text", text: "Quota exhausted" }], isError: true }
      await assert.rejects(execute({ action: "search", query: "example" }), /Quota exhausted/)

      response = { content: [] }
      await assert.rejects(execute({ action: "search", query: "example" }), /no content/)

      response = { content: [{ type: "image", data: "AA==", mimeType: "image/png" }] }
      await assert.rejects(execute({ action: "read", url: "https://example.com" }), /unsupported non-text/)

      mode = "json"
      response = { content: "invalid" }
      await assert.rejects(execute({ action: "read", url: "https://example.com" }))

      mode = "rate-limit"
      const beforeRateLimit = calls.filter(call => call.method === "tools/call").length
      await assert.rejects(execute({ action: "search", query: "example" }), { code: 429 })
      assert.equal(calls.filter(call => call.method === "tools/call").length, beforeRateLimit + 1)

      for (const pending of ["wait-call", "wait-initialize"] as const) {
          mode = pending
          const abort = new AbortController()
          const timer = setTimeout(() => abort.abort(new Error("Task cancelled")), 20)

          try {
              await assert.rejects(execute({ action: "read", url: "https://example.com" }, abort.signal), /Task cancelled/)
          } finally {
              clearTimeout(timer)
          }
      }

      const beforeAbort = calls.length
      await assert.rejects(execute({ action: "search", query: "example" }, AbortSignal.abort(new Error("Already cancelled"))), /Already cancelled/)
      assert.equal(calls.length, beforeAbort)
      assert(signals.every(signal => signal.aborted))

      const complete = { ...read, content: "Full source 🌍\n".repeat(5000) }
      const original = structuredClone(complete)
      const preview = web.modelOutput?.(complete) as { content: string, truncated: boolean, tokens: number, totalTokens: number }

      assert.equal(preview.truncated, true)
      assert(preview.tokens <= 2048)
      assert(preview.totalTokens > preview.tokens)
      assert(complete.content.startsWith(preview.content))
      assert.deepEqual(complete, original, "Model projection must not modify the durable result")
      assert.deepEqual(web.modelOutput?.(read), {
          ...read,
          truncated: false,
          tokens: estimatedTokens(read.content),
          totalTokens: estimatedTokens(read.content)
      })

      console.log("Web verified: input, JSON/SSE transport, provider failures, cancellation, cleanup, and bounded projection")
  } finally {
      globalThis.fetch = originalFetch
  }

  async function execute(input: unknown, signal = new AbortController().signal) {

      return webResult.parse(await web.execute(web.parse(input).input, { invocation: { signal } } as ToolContext))
  }

  function lastCall() {

      return calls.findLast(call => call.method === "tools/call")?.params
  }

  function json(id: unknown, result: unknown) {

      return Response.json({ jsonrpc: "2.0", id, result })
  }

  function wait(signal: AbortSignal): Promise<Response> {

      signal.throwIfAborted()

      return new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }))
  }
}, 120_000)
