import { DatabaseSync } from "node:sqlite"
import { afterEach, expect, test, vi } from "vitest"
import LemoDatabase from "../source/server/core/lemo/database"
import Memory from "../source/server/core/lemo/memory"
import Runtime from "../source/server/core/lemo/runtime/runtime"
import Cycle from "../source/server/core/lemo/cycle"
import type Tool from "../source/server/core/lemo/runtime/tool"
import type { ToolContext } from "../source/server/core/lemo/runtime/tool"
import docs from "../source/server/core/lemo/runtime/tools/docs/tool"
import type Operation from "../source/server/core/lemo/operation"
import type LLMModel from "../source/server/core/llm/model"
import type { LLMModelRequest, LLMToolCall } from "../source/server/core/llm/model"
import exa from "../source/server/core/lemo/runtime/tools/web/exa"

vi.mock("../source/server/core/lemo/runtime/tools/web/exa", () => ({ default: vi.fn() }))

const sources: DatabaseSync[] = []
afterEach(() => {
    for (const source of sources.splice(0)) source.close()
    vi.resetAllMocks()
})

async function fixture(call: LLMToolCall) {
    const source = new DatabaseSync(":memory:")
    sources.push(source)
    const database = await LemoDatabase.open(source)
    const memory = new Memory(database)
    const appended: Operation[] = []
    await database.createTask("current", { input: "Read evidence" })
    await database.appendToTask("current", "model.message", { content: "", toolCalls: [call] })
    const run = {
        task: "current", id: "test-run", signal: new AbortController().signal,
        async append(kind: string, payload: unknown) {
            const operation = await database.appendToTask("current", kind, payload)
            appended.push(operation)
            return operation
        }
    }
    let request: LLMModelRequest | undefined
    const model: LLMModel = {
        id: "test", reasoning: null, provider: { identity: "test" } as LLMModel["provider"],
        async contextWindow() { return 1_048_576 },
        async reasoningLevels() { return null },
        async setReasoning() {},
        async *generate(value) { request = value; return null }
    }
    const runtime = new Runtime(database, memory, () => ({} as never))
    return { source, database, memory, runtime, run, model, appended, request: () => request! }
}

test("Runtime persists only the web Tool's selected excerpt, never its complete live result", async () => {
    const call = { id: "web-call", name: "web", input: { action: "read", url: "https://example.test/" } }
    const f = await fixture(call)
    const content = "RETAINED_EVIDENCE " + "x".repeat(70_000) + "DISCARDED_RAW_TAIL"
    vi.mocked(exa).mockResolvedValue({
        request: { action: "read", url: "https://example.test/", maxCharacters: 20_000 },
        provider: "exa", content
    })
    const live = await f.runtime.execute(f.run, f.model, [call])
    expect(live).toHaveLength(1)
    expect(live[0]!.payload).toMatchObject({ output: { content }, transient: true })
    const saved = await f.database.operation("current", live[0]!.id)
    expect(saved?.payload).toMatchObject({ output: { truncated: true, tokens: 2_048 } })
    expect(JSON.stringify(f.appended)).not.toContain("DISCARDED_RAW_TAIL")
    expect(JSON.stringify(f.source.prepare("SELECT payload FROM operations").all())).not.toContain("DISCARDED_RAW_TAIL")
    expect((await f.memory.recall({ query: "RETAINED_EVIDENCE" })).length).toBeGreaterThan(0)
    expect(await f.memory.recall({ query: "DISCARDED_RAW_TAIL" })).toEqual([])

    await Cycle.run(f.database, f.memory, f.run, { ...f.model, async contextWindow() { return 16_384 } }, [], live)
    const message = f.request().messages.find(value => value.role === "tool")!
    const projected = JSON.parse(message.content)
    expect(projected).toMatchObject({ truncated: true, retainedBlock: { operation: saved!.id } })
    expect(projected.block).toBeUndefined()
    const block = await f.memory.block("current", saved!.id, 0, 4_096)
    expect(block.content).toContain("RETAINED_EVIDENCE")
    expect(block.content).not.toContain("DISCARDED_RAW_TAIL")
})

test("retrieval is delivered live without duplicating the retrieved text in another Task", async () => {
    const call = { id: "memory-call", name: "memory", input: { query: "personal name" } }
    const f = await fixture(call)
    await f.database.createTask("introduction", { input: "My personal name is Zouhir" })
    const live = await f.runtime.execute(f.run, f.model, [call])
    const saved = await f.database.operation("current", live[0]!.id)
    expect(saved?.payload).toMatchObject({ output: null })
    expect(JSON.stringify(f.appended)).not.toContain("My personal name is Zouhir")

    await Cycle.run(f.database, f.memory, f.run, f.model, [], live)
    expect(f.request().messages.find(value => value.role === "tool")?.content).toContain("My personal name is Zouhir")
    // Reconstructing after loss of live process memory explicitly marks unavailable results.
    await Cycle.run(f.database, f.memory, f.run, f.model, [])
    const result = f.request().messages.find(value => value.role === "tool")!
    expect(JSON.parse(result.content).output).toBeNull()
    expect(JSON.parse(result.content).notice).toContain("live context is unavailable")
    expect((await f.memory.recall({ query: "personal name" })).some(value => value.task === "introduction")).toBe(true)
})

test("execution failures retain an error without a successful raw result", async () => {
    const call = { id: "failed-call", name: "web", input: { action: "search", query: "evidence" } }
    const f = await fixture(call)
    vi.mocked(exa).mockRejectedValue(new Error("Provider unavailable"))
    expect(await f.runtime.execute(f.run, f.model, [call])).toEqual([])
    expect(f.appended.at(-1)?.payload).toMatchObject({ ok: false, error: "Provider unavailable" })
    await Cycle.run(f.database, f.memory, f.run, f.model, [])
    expect(f.request().messages.find(value => value.role === "tool")?.content).toContain("Provider unavailable")
})

test("the Tool contract requires an explicit retention decision", () => {
    const executionOnly: Omit<Tool, "retain"> = {
        definition: { name: "example", description: "example", parameters: {} }, docs: "",
        parse: input => ({ input, approval: false }), async execute() { return "raw" }
    }
    // @ts-expect-error execution alone cannot satisfy the Tool contract
    const incomplete: Tool = executionOnly
    expect(incomplete).toBe(executionOnly)
})

test("transient documentation remains fully readable through pages without retention", async () => {
    const documentation = "Useful documentation. ".repeat(1_000)
    const tools: ToolContext["tools"] = { list: () => [], async load() {}, find: () => ({
        definition: { name: "example", description: "", parameters: {} },
        docs: documentation, builtin: false
    }) }
    const context = { tools } as ToolContext
    let offset = 0
    let text = ""
    while (true) {
        const input = docs.parse({ name: "example", offset, tokens: 256 }).input
        const page = await docs.execute(input, context) as { docs: string, next: number | null }
        expect(docs.retain(page, input)).toBeNull()
        text += page.docs
        if (page.next === null) break
        expect(page.next).toBeGreaterThan(offset)
        offset = page.next
    }
    expect(text).toBe(documentation)
})

test("instructions and Tool definitions must fit before a Model is called", async () => {
    const f = await fixture({ id: "unused", name: "time", input: {} })
    const model = { ...f.model, async contextWindow() { return 16_384 } }
    const tools = [{ name: "large", description: "x".repeat(70_000), parameters: {} }]
    await expect(Cycle.run(f.database, f.memory, f.run, model, tools)).rejects.toThrow("no room")
    expect(f.request()).toBeUndefined()
})
