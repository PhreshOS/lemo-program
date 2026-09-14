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

test.each(["initial", "ongoing"] as const)("%s Task context scales with Model capacity and includes request overhead", async phase => {
    const percentage = phase === "initial" ? 35 : 70
    for (const capacity of [null, 16_384, 124_000, 1_048_576]) {
        const budgets = await cycleContextBudgets({ async contextWindow() { return capacity } }, phase, 2_000)
        const ceiling = Math.floor((capacity ?? 65_536) * percentage / 100)
        expect(budgets.input).toBe(ceiling)
        expect(budgets.perceptualField + budgets.transcript + 2_000).toBe(ceiling)
        expect(budgets.perceptualField).toBeLessThanOrEqual(8_000)
        expect(budgets.transcript).toBeGreaterThan(0)
    }
    await expect(cycleContextBudgets({ async contextWindow() { return 1 } }, phase)).rejects.toThrow("invalid context window")
    await expect(cycleContextBudgets({ async contextWindow() { return 2 } }, phase)).rejects.toThrow("no room")
    await expect(cycleContextBudgets({ async contextWindow() { return 16_384 } }, phase, 13_000)).rejects.toThrow("no room")
})

test("recall searches conversations, retained results, explicit facts and failures", async () => {
    const { database, memory } = await fixture()
    await database.createTask("previous", { input: "needle raw user request" })
    await database.appendToTask("previous", "model.message", { content: "needle raw assistant answer" })
    await database.appendToTask("previous", "model.event", {
        type: "tool-call", call: { id: "call", name: "files", input: { content: "needle raw arguments" } }
    })
    await database.appendToTask("previous", "tool.result", {
        call: "call", name: "files", ok: true,
        output: "needle retained output"
    })
    await database.appendToTask("previous", "tool.result", {
        call: "failed", name: "files", ok: false, error: "needle failure"
    })
    await database.appendToTask("previous", "task.failed", { message: "needle task failure" })
    const fact = await remember(memory, "previous", "needle selected fact")
    const results = await memory.recall({ query: "needle" })
    expect(results).toHaveLength(6)
    expect(new Set(results.map(result => result.kind))).toEqual(new Set([
        "task.input", "model.message", "tool.result", "task.failed", "memory.recorded"
    ]))
    expect(results.find(result => result.operation === fact.id)).toMatchObject({
        operation: fact.id, content: "needle selected fact", tool: "files",
        source: "filesystem:project", method: "files.write", kind: "memory.recorded"
    })
    expect((await database.recentContextOperations(100))).toHaveLength(6)
    expect((await database.searchContextOperations(["needle"], 100))).toHaveLength(6)
    expect(JSON.stringify(results)).not.toContain("needle raw arguments")
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
                output: "RETAINED_SENTINEL ".repeat(1_000)
            })
        }
    }
    const before = source.prepare("SELECT count(*) AS count FROM operations").get()
    await database.createTask("current", { input: "hello" })
    const operations = (await database.operations("current", { limit: 10, order: "oldest" })).operations
    const context = await memory.context(operations, 845_625)
    expect(estimatedTokens(context)).toBeLessThan(1_000)
    expect(context).not.toMatch(/HISTORY_SENTINEL|RETAINED_SENTINEL/)
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

test("complete Tool-retained results stay searchable and accessible through paging", async () => {
    const { database, memory } = await fixture()
    await database.createTask("previous", { input: "Read the workspace" })
    const result = await database.appendToTask("previous", "tool.result", {
        call: "read", name: "files", ok: true,
        output: { content: "RETAINED_FILE_SENTINEL ".repeat(2_000) }
    })
    expect((await memory.recall({ query: "RETAINED_FILE_SENTINEL" }))[0]).toMatchObject({ operation: result.id, truncated: true })
    expect((await memory.task("previous", 1_000)).content).toContain("RETAINED_FILE_SENTINEL")
    expect((await memory.block("previous", result.id, 0, 256)).content).toContain("RETAINED_FILE_SENTINEL")
})

async function captureCycle(database: LemoDatabase, memory: Memory, task: string, capacity = 1_048_576) {
    let captured: LLMModelRequest | undefined
    const model: LLMModel = {
        id: "capture",
        provider: { identity: "test", name: "Test", active: true, async models() { return [model] } },
        reasoning: null,
        async contextWindow() { return capacity },
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

test("the first request uses 35%, then the same Task can grow to 70% across runs and reconstruction", async () => {
    const { source, database, memory } = await fixture()
    const capacity = 100_000
    await database.createTask("current", { input: "Keep all decisions" })
    const initial = await captureCycle(database, memory, "current", capacity)
    expect(estimatedTokens(JSON.stringify(initial))).toBeLessThanOrEqual(35_000)

    const decision = "Important decision. ".repeat(8_000)
    await database.appendToTask("current", "model.message", { content: decision })
    const ongoing = await captureCycle(database, memory, "current", capacity)
    expect(ongoing.messages.some(message => message.role === "assistant" && message.content === decision)).toBe(true)
    expect(estimatedTokens(JSON.stringify(ongoing))).toBeGreaterThan(35_000)
    expect(estimatedTokens(JSON.stringify(ongoing))).toBeLessThanOrEqual(70_000)

    await database.appendToTask("current", "task.paused", { reason: "requested" })
    await database.appendToTask("current", "task.run.started", { run: "continued-run", reason: "continued" })
    const reopened = await LemoDatabase.open(source)
    const continued = await captureCycle(reopened, new Memory(reopened), "current", capacity)
    expect(continued.messages.some(message => message.role === "assistant" && message.content === decision)).toBe(true)
    expect(estimatedTokens(JSON.stringify(continued))).toBeGreaterThan(35_000)
    expect(estimatedTokens(JSON.stringify(continued))).toBeLessThanOrEqual(70_000)
})

test("a Task without a Model response cannot bypass the initial ceiling by starting another run", async () => {
    const { database, memory } = await fixture()
    const input = "x".repeat(150_000)
    await database.createTask("current", { input })
    await expect(captureCycle(database, memory, "current", 100_000)).rejects.toThrow("Task conversation exceeds")
    await database.appendToTask("current", "task.run.started", { run: "retry", reason: "continued" })
    await expect(captureCycle(database, memory, "current", 100_000)).rejects.toThrow("Task conversation exceeds")
    expect((await database.firstOperation("current", "task.input"))!.payload).toMatchObject({ input })
})

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
    expect(assistants).toHaveLength(10)
    expect(results.map(result => result.call)).toEqual(assistants.flatMap(message =>
        message.toolCalls?.map(call => call.id) ?? []))
    expect(results.at(-1)?.call).toBe("call-9")
    expect(estimatedTokens(JSON.stringify(request.messages.slice(2)))).toBeGreaterThan(30_000)
})

test("oversized arguments are compacted without changing retained history or breaking call/result pairs", async () => {
    const { database, memory } = await fixture()
    await database.createTask("current", { input: "Write the file" })
    await database.appendToTask("current", "model.message", { content: "OLDER_TURN" })
    const call = await database.appendToTask("current", "model.message", {
        content: "Writing",
        toolCalls: [{ id: "large", name: "files", input: { content: "x".repeat(60_000) } }]
    })
    await database.appendToTask("current", "tool.result", {
        call: "large", name: "files", ok: true, output: { saved: true }
    })
    const request = await captureCycle(database, memory, "current", 16_384)
    const assistants = request.messages.filter(message => message.role === "assistant")
    const latest = assistants.at(-1)!
    expect(latest.toolCalls?.[0]?.input).toMatchObject({ truncated: true, block: { operation: call.id } })
    expect(request.messages.filter(message => message.role === "tool")).toHaveLength(1)
    expect(estimatedTokens(JSON.stringify(request.messages.slice(2)))).toBeLessThanOrEqual(12_000)
    expect((await database.operation("current", call.id))!.payload).toMatchObject({
        toolCalls: [{ input: { content: "x".repeat(60_000) } }]
    })
})

test("a user's earlier name remains retrievable in another Task without an explicit memory record", async () => {
    const { database, memory } = await fixture()
    const name = await database.createTask("introduction", { input: "My name is Zouhir" })
    await database.appendToTask("introduction", "model.message", { content: "Hi Zouhir" })
    await database.createTask("question", { input: "What is my name?" })
    const results = await memory.recall({ query: "user's name identity" }, { excludeTask: "question" })
    expect(results.some(result => result.operation === name.id && result.source === "user")).toBe(true)
    const request = await captureCycle(database, memory, "question")
    expect(JSON.stringify(request.messages)).toContain("My name is Zouhir")
})

test("parallel Tool exchanges remain paired when individually large results are compacted", async () => {
    const { database, memory } = await fixture()
    await database.createTask("current", { input: "Read the sources" })
    const calls = Array.from({ length: 24 }, (_, index) => ({ id: `call-${index}`, name: "files", input: { path: `${index}.txt` } }))
    await database.appendToTask("current", "model.message", { content: "", toolCalls: calls })
    for (const call of calls) await database.appendToTask("current", "tool.result", {
        call: call.id, name: call.name, ok: true, output: "x".repeat(60_000)
    })
    const request = await captureCycle(database, memory, "current", 24_000)
    expect(request.messages.filter(value => value.role === "tool").map(value => value.call)).toEqual(calls.map(call => call.id))
    expect(estimatedTokens(JSON.stringify(request.messages.slice(2)))).toBeLessThanOrEqual(12_000)
})

test("a Task transcript is not cut off by an arbitrary operation count", async () => {
    const { database } = await fixture()
    await database.createTask("current", { input: "Read sources" })
    const message = await database.appendToTask("current", "model.message", {
        content: "", toolCalls: Array.from({ length: 5 }, (_, index) => ({ id: `${index}`, name: "files", input: {} }))
    })
    for (let index = 0; index < 5; index++) await database.appendToTask("current", "tool.result", {
        call: `${index}`, name: "files", ok: true, output: index
    })
    for (let index = 0; index < 600; index++) await database.appendToTask("current", "model.message", { content: `Decision ${index}` })
    const operations = await database.transcriptOperations("current")
    expect(operations[0]!.id).toBe(message.id)
    expect(operations).toHaveLength(606)
})

test("the complete user request remains available when the Model has capacity", async () => {
    const { database, memory } = await fixture()
    const input = "user content ".repeat(30_000)
    const operation = await database.createTask("current", { input })
    const request = await captureCycle(database, memory, "current")
    expect(request.messages[2]!.content).toBe(input)
    expect((await database.operation("current", operation.id))!.payload).toMatchObject({ input })
    await expect(captureCycle(database, memory, "current", 16_384)).rejects.toThrow("Task conversation exceeds")
})

test("Task history cursors cover records omitted by the token budget", async () => {
    const { database, memory } = await fixture()
    await database.createTask("previous", { input: "Read sources" })
    const identities: string[] = []
    for (let index = 0; index < 12; index++) {
        const operation = await database.appendToTask("previous", "tool.result", {
            call: `${index}`, name: "files", ok: true, output: `source ${index}: ` + "x".repeat(8_000)
        })
        identities.push(operation.id)
    }
    const seen = new Set<string>()
    let before: number | undefined
    for (let page = 0; page < 20; page++) {
        const history = await memory.task("previous", 1_000, before)
        for (const identity of identities) if (history.content.includes(identity)) seen.add(identity)
        if (history.before === null) break
        expect(history.before).toBeLessThan(before ?? Infinity)
        before = history.before
    }
    expect(seen).toEqual(new Set(identities))
})

test("focused evidence is not crowded out by large catalogs matching generic query words", async () => {
    const { database, memory } = await fixture()
    const statement = await database.createTask("introduction", { input: "My name is Zouhir" })
    const vocabulary = Array.from({ length: 400 }, (_, index) => `unrelated${index}`).join(" ")
    for (let index = 0; index < 10; index++) {
        await database.createTask(`catalog-${index}`, { input: "Discover capabilities" })
        await database.appendToTask(`catalog-${index}`, "tool.result", {
            call: `${index}`, name: "programs", ok: true,
            output: { name: "Program", identity: `${index}`, user: "context", vocabulary }
        })
    }
    const results = await memory.recall({ query: "user's name identity", budget: 1_000 })
    expect(results[0]!.operation).toBe(statement.id)
})

test("possessive query syntax does not create an unrelated single-letter match", async () => {
    const { database, memory } = await fixture()
    const statement = await database.createTask("introduction", { input: "My name is Zouhir" })
    await database.createTask("unrelated", { input: "It's ready" })
    const results = await memory.recall({ query: "user’s name identity" })
    expect(results.map(result => result.operation)).toEqual([statement.id])
    expect(results[0]!.matches).toEqual(["name"])
})
