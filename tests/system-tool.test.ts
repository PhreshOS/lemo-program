import { parseExecuteRequest } from "@phreshos/core"
import { expect, test } from "vitest"
import type { ToolContext } from "../source/server/core/lemo/runtime/tool"
import retainSystemResult from "../source/server/core/lemo/runtime/tools/system/retention"
import systemTool from "../source/server/core/lemo/runtime/tools/system/tool"

test("System Tool exposes Core's Execute contract directly", async () => {
    const request = {
        $domain: "operation" as const,
        $operation: "list" as const,
        domain: "endpoint"
    }

    expect(systemTool.parse(request).input).toEqual(parseExecuteRequest(request))

    const result = await systemTool.execute(request, {} as ToolContext) as readonly {
        domain: string
        operation: string
    }[]

    expect(result.length).toBeGreaterThan(0)
    expect(result.every(operation => operation.domain === "endpoint")).toBe(true)
    expect(result.some(operation => operation.operation === "ask")).toBe(true)

    expect(systemTool.parse({
        $domain: "program",
        $operation: "logs",
        identity: "terminal",
        statement: "select createdAt, process, source, kind, content from logs"
    }).input).toEqual(parseExecuteRequest({
        $domain: "program",
        $operation: "logs",
        identity: "terminal",
        statement: "select createdAt, process, source, kind, content from logs"
    }))
})

test("System Tool owns only Lemo's result-retention policy", () => {
    expect(retainSystemResult("agent contract", {
        $domain: "program",
        $operation: "agent",
        identity: "example"
    })).toBeNull()

    expect(retainSystemResult({ identity: "process" }, {
        $domain: "process",
        $operation: "find",
        process: "process"
    })).toEqual({ identity: "process" })

    const rows = Array.from({ length: 100 }, (_, index) => ({
        createdAt: index,
        process: "main",
        source: "server",
        kind: "log",
        content: "x".repeat(1_000)
    }))

    expect(retainSystemResult(rows, {
        $domain: "program",
        $operation: "logs",
        identity: "example",
        statement: "select * from logs"
    })).toMatchObject({ kind: "large-program-logs-result" })
})
