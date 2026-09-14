import { DatabaseSync } from "node:sqlite"
import { afterEach, expect, test } from "vitest"
import LemoDatabase, { memoryReinforcementHalfLife } from "../source/server/core/lemo/database"
import Memory from "../source/server/core/lemo/memory"
import { cycleContextBudgets } from "../source/server/core/lemo/context"
import { estimatedTokens } from "../source/server/core/lemo/token-budget"
import Cycle from "../source/server/core/lemo/cycle"
import type LLMModel from "../source/server/core/llm/model"
import type { LLMModelRequest } from "../source/server/core/llm/model"

const sources: DatabaseSync[] = []

afterEach(() => {
    for (const source of sources.splice(0)) source.close()
})

async function fixture() {
    const source = new DatabaseSync(":memory:")
    sources.push(source)
    const database = await LemoDatabase.open(source)
    const memory = new Memory(database)
    return { source, database, memory }
}

async function remember(memory: Memory, task: string, content: string, source = "filesystem:project") {
    return memory.record({ task, tool: "files", call: "write-project" }, {
        content, source, method: "files.write"
    })
}

test("model capacity is a ceiling, not a target for context growth", async () => {
    const normal = { perceptualField: 8_000, transcript: 12_000 }
    for (const size of [null, 124_000, 1_048_576]) {
        expect(await cycleContextBudgets({ async contextWindow() { return size } })).toEqual(normal)
    }
    const smaller = await cycleContextBudgets({ async contextWindow() { return 16_384 } })
    expect(smaller.perceptualField + smaller.transcript).toBe(12_288)
    expect(smaller.perceptualField).toBeLessThan(normal.perceptualField)
    await expect(cycleContextBudgets({ async contextWindow() { return 1 } })).rejects.toThrow("invalid context window")
    await expect(cycleContextBudgets({ async contextWindow() { return 4_096 } })).rejects.toThrow("no room")
})

test("only Tool-selected facts enter recall; execution previews and failures remain history", async () => {
    const { database, memory } = await fixture()
    await database.createTask("previous", { input: "needle raw user request" })
    await database.appendToTask("previous", "model.message", { content: "needle raw assistant answer" })
    await database.appendToTask("previous", "model.event", {
        type: "tool-call", call: { id: "call", name: "files", input: { content: "needle raw arguments" } }
    })
    await database.appendToTask("previous", "tool.result", {
        call: "call", name: "files", ok: true,
        output: "needle full output", modelOutput: "needle execution preview"
    })
    await database.appendToTask("previous", "tool.result", {
        call: "failed", name: "files", ok: false, error: "needle failure"
    })
    await database.appendToTask("previous", "task.failed", { message: "needle task failure" })
    expect(await memory.recall({ query: "needle" })).toEqual([])

    const fact = await remember(memory, "previous", "needle selected fact")
    const results = await memory.recall({ query: "needle" })
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({
        operation: fact.id, content: "needle selected fact", tool: "files",
        source: "filesystem:project", method: "files.write", kind: "memory.recorded"
    })
    expect((await database.recentContextOperations(100)).map(value => value.id)).toEqual([fact.id])
    expect((await database.searchContextOperations(["needle"], 100)).map(value => value.id)).toEqual([fact.id])
})

test("large neighbouring histories do not fill a new Task's context", async () => {
    const { source, database, memory } = await fixture()
    for (let index = 0; index < 20; index++) {
        const task = `history-${index}`
        await database.createTask(task, { input: "Investigate previous work" })
        for (let turn = 0; turn < 10; turn++) {
            await database.appendToTask(task, "model.message", { content: "HISTORY_SENTINEL ".repeat(1_000) })
            await database.appendToTask(task, "tool.result", {
                call: `call-${turn}`, name: "web", ok: true,
                output: "RAW_SENTINEL ".repeat(1_000), modelOutput: "PREVIEW_SENTINEL ".repeat(500)
            })
        }
    }
    const before = source.prepare("SELECT count(*) AS count FROM operations").get()
    await database.createTask("current", { input: "hello" })
    const operations = (await database.operations("current", { limit: 10, order: "oldest" })).operations
    const context = await memory.context(operations, 845_625)
    expect(estimatedTokens(context)).toBeLessThan(1_000)
    expect(context).not.toMatch(/HISTORY_SENTINEL|RAW_SENTINEL|PREVIEW_SENTINEL/)
    expect(context).toContain('budget="8000"')
    expect(Number(source.prepare("SELECT count(*) AS count FROM operations").get()!.count))
        .toBe(Number(before!.count) + 1)
    expect(source.prepare("SELECT count(*) AS count FROM memory_retrievals").get()!.count).toBe(0)
})

test("recall deduplicates identical facts but preserves independent sources", async () => {
    const { database, memory } = await fixture()
    await database.createTask("previous", { input: "Work" })
    for (let index = 0; index < 20; index++) await remember(memory, "previous", "needle project fact")
    await remember(memory, "previous", "needle project fact", "filesystem:other-project")
    const results = await memory.recall({ query: "needle" })
    expect(results).toHaveLength(2)
    expect(new Set(results.map(result => result.source)).size).toBe(2)
    expect(await memory.recall({ query: "unrelated bananas" })).toEqual([])
})

test("automatic context selects relevant records once without reinforcing them", async () => {
    const { source, database, memory } = await fixture()
    await database.createTask("previous", { input: "Work" })
    const fact = await remember(memory, "previous", "needle project fact")
    await database.createTask("current", { input: "needle" })
    const operations = (await database.operations("current", { limit: 10, order: "oldest" })).operations
    for (let cycle = 0; cycle < 10; cycle++) {
        const context = await memory.context(operations)
        expect(context.split("needle project fact")).toHaveLength(2)
    }
    expect((await database.memoryActivations([fact.id])).size).toBe(0)
    expect(source.prepare("SELECT count(*) AS count FROM memory_retrievals").get()!.count).toBe(0)

    for (let index = 0; index < 6; index++) await memory.recall({ query: "needle" })
    const activation = (await database.memoryActivations([fact.id])).get(fact.id)!
    expect(activation.retrievalCount).toBe(6)
    await memory.context(operations)
    expect((await database.memoryActivations([fact.id])).get(fact.id)!.retrievalCount).toBe(6)
    const faded = (await database.memoryActivations([fact.id],
        activation.lastRetrievedAt + memoryReinforcementHalfLife)).get(fact.id)!
    expect(faded.strength).toBeCloseTo(activation.strength / 2, 5)

    await database.createTask("unrelated", { input: "bananas" })
    const unrelated = await memory.context((await database.operations("unrelated", {
        limit: 10, order: "oldest"
    })).operations)
    expect(unrelated).not.toContain("needle project fact")
})

test("a bounded recall admits small facts and keeps complete records available for paging", async () => {
    const { database, memory } = await fixture()
    await database.createTask("previous", { input: "Work" })
    await remember(memory, "previous", "needle small fact")
    const long = await remember(memory, "previous", "needle large fact ".repeat(2_000))
    const compact = await memory.recall({ query: "needle", budget: 1_000 })
    expect(compact.some(result => result.content === "needle small fact")).toBe(true)
    expect(compact.reduce((total, result) => total + estimatedTokens(result.content), 0)).toBeLessThan(1_000)
    const first = await memory.block("previous", long.id, 0, 256)
    expect(first.next).not.toBeNull()
    expect(first.totalTokens).toBeGreaterThan(first.tokens)
    const second = await memory.block("previous", long.id, first.next!, 256)
    expect(second.offset).toBe(first.next)
    expect((await database.operation("previous", long.id))!.payload).toMatchObject({
        record: { content: "needle large fact ".repeat(2_000) }
    })
    await expect(memory.recall({ query: "needle", budget: 120 })).rejects.toThrow("Memory recall budget")
})

test("raw execution results remain inspectable independently of memory", async () => {
    const { database, memory } = await fixture()
    await database.createTask("previous", { input: "Read the workspace" })
    const result = await database.appendToTask("previous", "tool.result", {
        call: "read", name: "files", ok: true,
        output: { content: "RAW_FILE_SENTINEL ".repeat(2_000) },
        modelOutput: { content: "short preview" }
    })
    expect(await memory.recall({ query: "RAW_FILE_SENTINEL" })).toEqual([])
    expect((await memory.task("previous", 1_000)).content).toContain("short preview")
    expect((await memory.block("previous", result.id, 0, 256)).content).toContain("RAW_FILE_SENTINEL")
})

async function captureCycle(database: LemoDatabase, memory: Memory, task: string) {
    let captured: LLMModelRequest | undefined
    const model: LLMModel = {
        id: "capture",
        provider: { identity: "test", name: "Test", active: true, async models() { return [model] } },
        reasoning: null,
        async contextWindow() { return 1_048_576 },
        async reasoningLevels() { return null },
        async setReasoning() {},
        async *generate(request) { captured = request; return null }
    }
    await Cycle.run(database, memory, {
        task, id: "capture-run", signal: new AbortController().signal,
        append: (kind, payload) => database.appendToTask(task, kind, payload)
    }, model, [])
    return captured!
}

test("transcript budgeting counts full arguments and retains complete exchanges", async () => {
    const { database, memory } = await fixture()
    await database.createTask("current", { input: "Keep working" })
    for (let index = 0; index < 10; index++) {
        await database.appendToTask("current", "model.message", {
            content: "Writing files",
            toolCalls: [{ id: `call-${index}`, name: "files", input: { content: "x".repeat(12_000) } }]
        })
        await database.appendToTask("current", "tool.result", {
            call: `call-${index}`, name: "files", ok: true, output: { saved: true }
        })
    }
    const request = await captureCycle(database, memory, "current")
    const assistants = request.messages.filter(message => message.role === "assistant")
    const results = request.messages.filter(message => message.role === "tool")
    expect(assistants.length).toBeLessThan(4)
    expect(results.map(result => result.call)).toEqual(assistants.flatMap(message =>
        message.toolCalls?.map(call => call.id) ?? []))
    expect(results.at(-1)?.call).toBe("call-9")
    expect(estimatedTokens(JSON.stringify(request.messages.slice(3)))).toBeLessThan(12_000)
})

test("the latest oversized exchange stays intact without retaining older exchanges", async () => {
    const { database, memory } = await fixture()
    await database.createTask("current", { input: "Write the file" })
    await database.appendToTask("current", "model.message", { content: "OLDER_TURN" })
    await database.appendToTask("current", "model.message", {
        content: "Writing",
        toolCalls: [{ id: "large", name: "files", input: { content: "x".repeat(60_000) } }]
    })
    await database.appendToTask("current", "tool.result", {
        call: "large", name: "files", ok: true, output: { saved: true }
    })
    const request = await captureCycle(database, memory, "current")
    const assistants = request.messages.filter(message => message.role === "assistant")
    expect(assistants).toHaveLength(1)
    expect(assistants[0]!.toolCalls?.[0]?.input).toEqual({ content: "x".repeat(60_000) })
    expect(request.messages.filter(message => message.role === "tool")).toHaveLength(1)
})
