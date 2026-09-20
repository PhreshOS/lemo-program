import { DatabaseSync } from "node:sqlite"
import { expect, test } from "vitest"
import Lemo from "../source/server/core/lemo/lemo"
import type LLMModel from "../source/server/core/llm/model"
import type { LLMModelRequest } from "../source/server/core/llm/model"
import systemTool from "../source/server/core/lemo/runtime/tools/system/tool"

function documentation(request: LLMModelRequest, call = "window-docs") {
    const result = request.messages.find(message => message.role === "tool" && message.call === call)
    expect(result).toBeDefined()
    expect(JSON.parse(result!.content).output.docs).toBe(systemTool.docs)
}

test.each([false, true])("Tool documentation survives multiple cycles; pause/continue=%s", async pause => {
    const source = new DatabaseSync(":memory:")
    const lemo = await Lemo.wakeUp(source)
    let cycle = 0
    const entered = Promise.withResolvers<void>()
    const model: LLMModel = {
        id: "continuity", reasoning: null,
        provider: { identity: "test" } as LLMModel["provider"],
        async contextWindow() { return 1_048_576 },
        async reasoningLevels() { return null }, async setReasoning() {},
        async *generate(request) {
            cycle++
            if (cycle === 1) {
                yield { type: "tool-call", call: { id: "window-docs", name: "docs", input: { name: "system" } } }
                yield { type: "tool-call", call: { id: "load-time", name: "tools", input: { names: ["time"] } } }
                return null
            }
            documentation(request)
            if (pause && cycle === 3) {
                entered.resolve()
                await new Promise<void>(() => {})
            }
            if (cycle < 5) {
                yield { type: "tool-call", call: { id: `time-${cycle}`, name: "time", input: {} } }
                return null
            }
            // The contract needed for the final step is still available after intervening calls.
            expect(systemTool.parse({
                $domain: "window", $operation: "setGeometry", process: "example",
                x: 0, y: 0, width: "50%", height: "100%"
            }).input).toMatchObject({ $domain: "window", $operation: "setGeometry" })
            yield { type: "text", content: "complete" }
            return null
        }
    }
    try {
        const task = await lemo.task({ input: "Use the Window contract after several observations", model })
        if (pause) {
            await entered.promise
            await task.pause()
            expect(await task.status()).toBe("paused")
            await task.continue(model)
        }
        expect(await task.result()).toBe("complete")
        expect(cycle).toBe(5)
        const result = (await task.operations()).find(operation =>
            operation.kind === "tool.result" && (operation.payload as { call: string }).call === "window-docs")
        expect(result?.payload).toMatchObject({ output: null, retained: false })
        expect(JSON.stringify(source.prepare("SELECT payload FROM operations").all())).not.toContain(systemTool.docs)

        const other = await lemo.task({ input: "Independent task", model: {
            ...model,
            async *generate(request) {
                expect(request.messages.some(message => message.role === "tool")).toBe(false)
                yield { type: "text", content: "independent" }
                return null
            }
        } })
        expect(await other.result()).toBe("independent")
    } finally { source.close() }
})

test("completed parallel results survive pausing a different unfinished Tool", async () => {
    const source = new DatabaseSync(":memory:")
    const lemo = await Lemo.wakeUp(source)
    const read = Promise.withResolvers<void>()
    const unsubscribe = lemo.subscribe(operation => {
        if (operation.kind === "tool.result" && (operation.payload as { call: string }).call === "parallel-docs") read.resolve()
    })
    let cycle = 0
    const model: LLMModel = {
        id: "parallel", reasoning: null, provider: { identity: "test" } as LLMModel["provider"],
        async contextWindow() { return 124_000 },
        async reasoningLevels() { return null }, async setReasoning() {},
        async *generate(request) {
            cycle++
            if (cycle === 1) {
                yield { type: "tool-call", call: { id: "load", name: "tools", input: { names: ["tasks"] } } }
            } else if (cycle === 2) {
                yield { type: "tool-call", call: { id: "parallel-docs", name: "docs", input: { name: "system" } } }
                yield { type: "tool-call", call: { id: "wait", name: "tasks", input: { action: "wait_message", event: "never", timeout: 60_000 } } }
            } else {
                documentation(request, "parallel-docs")
                const interrupted = request.messages.find(message => message.role === "tool" && message.call === "wait")
                expect(JSON.parse(interrupted!.content).ok).toBe(false)
                yield { type: "text", content: "continued" }
            }
            return null
        }
    }
    try {
        const task = await lemo.task({ input: "Read while waiting", model })
        await read.promise
        await task.pause()
        await task.continue(model)
        expect(await task.result()).toBe("continued")
    } finally { unsubscribe(); source.close() }
})
