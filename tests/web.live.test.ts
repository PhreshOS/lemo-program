import assert from "node:assert/strict"
import type { ToolContext } from "../source/server/core/lemo/runtime/tool"
import { webResult } from "../source/server/core/lemo/runtime/tools/web/contract"
import web from "../source/server/core/lemo/runtime/tools/web/tool"
import { test } from "vitest"

test("web live contract", async () => {
  const context = { invocation: { signal: AbortSignal.timeout(60_000) } } as ToolContext

  for (const input of [
      { action: "search", query: "MDN JavaScript Promise documentation", count: 2 },
      { action: "read", url: "https://example.com", maxCharacters: 2000 }
  ]) {
      const result = webResult.parse(await web.execute(web.parse(input).input, context))

      assert(result.content.length > 0)
      assert.match(result.content, /https?:\/\//)

      if (input.action === "search") assert.match(result.content, /Promise/i)
      else assert.match(result.content, /Example Domain/i)

      console.log(JSON.stringify({ action: input.action, provider: result.provider, content: result.content }))
  }
}, 120_000)
