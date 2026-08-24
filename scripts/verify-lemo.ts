import assert from "node:assert/strict"
import { DatabaseSync } from "node:sqlite"
import type { Subscribable } from "@phreshos/core"
import LemoDatabase from "../source/server/core/lemo/database"
import Lemo from "../source/server/core/lemo/lemo"
import Memory from "../source/server/core/lemo/memory"
import type LLMModel from "../source/server/core/llm/model"
import type LLMProvider from "../source/server/core/llm/provider"
import endpoints, { endpointModelOutput } from "../source/server/core/lemo/runtime/tools/endpoints/endpoints"
import processes from "../source/server/core/lemo/runtime/tools/processes/processes"
import programs from "../source/server/core/lemo/runtime/tools/programs/programs"
import windows from "../source/server/core/lemo/runtime/tools/windows/windows"
import toolInput from "../source/server/core/lemo/runtime/tool-input"
import waitEvent from "../source/server/core/lemo/runtime/wait-event"

assert.match(windows.definition.description, /numbers are pixels, never proportions/i)
assert.match(JSON.stringify(windows.definition.parameters), /0\.5 means half a pixel/)
assert.match(windows.docs, /"width": "50%", "height": "100%"/)
assert.match(JSON.stringify(programs.definition.parameters), /"const":"wait"/)
assert.match(JSON.stringify(processes.definition.parameters), /"const":"wait"/)
assert.match(JSON.stringify(endpoints.definition.parameters), /"const":"wait"/)
assert.match(JSON.stringify(windows.definition.parameters), /"const":"wait"/)

const immediateEvents = {
    async *events() { yield Object.freeze({ value: "received" }) }
} as unknown as Subscribable

assert.deepEqual(
    await waitEvent(immediateEvents, "change", new AbortController().signal, 100),
    { value: "received" }
)

const idleEvents = {
    async *events(_event: string, options: { signal?: AbortSignal } = {}) {

        await new Promise<void>(resolve => {

            if (options.signal?.aborted) resolve()
            else options.signal?.addEventListener("abort", () => resolve(), { once: true })
        })
    }
} as unknown as Subscribable

await assert.rejects(
    waitEvent(idleEvents, "change", new AbortController().signal, 5),
    /timeout 5ms/
)
assert.deepEqual(toolInput({
    action: "setGeometry",
    process: "lemo-process",
    position: "{\"x\":0,\"y\":0}",
    size: "{\"width\":\"50%\",\"height\":\"100%\"}"
}, windows.definition.parameters), {
    action: "setGeometry",
    process: "lemo-process",
    position: { x: 0, y: 0 },
    size: { width: "50%", height: "100%" }
})

assert.deepEqual(toolInput({
    action: "setGeometry",
    position: "{\"x\":\"0/1\",\"y\":\"0/1\"}",
    size: "{\"width\":\"1/2\",\"height\":\"1/1\"}",
    minimized: "false"
}, {
    oneOf: [{
        type: "object",
        properties: {
            action: { const: "setGeometry" },
            position: { type: "object", properties: { x: { type: "string" }, y: { type: "string" } } },
            size: {
                type: "object",
                properties: { width: { type: ["number", "string"] }, height: { type: ["number", "string"] } }
            },
            minimized: { type: "boolean" }
        }
    }]
}), {
    action: "setGeometry",
    position: { x: "0/1", y: "0/1" },
    size: { width: "1/2", height: "1/1" },
    minimized: false
})

assert.equal(toolInput("{\"raw\":true}", {}), "{\"raw\":true}")

const jsonValue = {
    oneOf: [
        { type: "object" },
        { type: "array", items: {} },
        { type: "string" },
        { type: "number" },
        { type: "boolean" },
        { type: "null" }
    ]
}

const endpointInput = {
    type: "object",
    properties: {
        action: { type: "string" },
        payload: jsonValue
    }
}

assert.deepEqual(toolInput({
    action: "ask",
    payload: "{\"client\":true,\"viewport\":{\"width\":1280,\"height\":720}}"
}, endpointInput), {
    action: "ask",
    payload: { client: true, viewport: { width: 1280, height: 720 } }
})

assert.deepEqual(toolInput({ action: "ask", payload: "{}" }, endpointInput), {
    action: "ask",
    payload: {}
})

assert.deepEqual(toolInput({ action: "ask", payload: "null" }, endpointInput), {
    action: "ask",
    payload: null
})

assert.deepEqual(endpointModelOutput({
    id: "snapshot",
    image: "A".repeat(10_000),
    title: "PhreshOS"
}), {
    id: "snapshot",
    image: {
        kind: "binary",
        characters: 10_000,
        note: "Binary content is retained in the database but omitted from text Model context."
    },
    title: "PhreshOS"
})

const database = new DatabaseSync(":memory:")

const client = {
    publish() {},
    subscribe() { return () => {} }
}

const lemo = await Lemo.wakeUp(database, client)

assert(lemo instanceof Lemo)

await Lemo.wakeUp(database, client)

const tables = database.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
`).all().map(row => row.name)

assert.deepEqual(tables, [
    "operation_relationships",
    "operations",
    "tasks"
])

const foreignKeys = database.prepare("PRAGMA foreign_keys").get()

assert.equal(foreignKeys?.foreign_keys, 1)

const first = deferred()
const second = deferred()
const cycles = new Map<string, number>()
const snapshots = new Map<string, string[]>()

let model!: LLMModel

const provider: LLMProvider = {
    identity: "test",
    name: "Test",
    active: true,
    async models() {

        return [model]
    }
}

model = {
    id: "test-model",
    provider,
    async *generate(request) {

        const input = request.messages.findLast(message => message.role === "user")?.content

        assert(input)

        const snapshot = request.messages.find(message => (
            message.role === "system" && message.content.startsWith("# Reconstructed Cycle Context")
        ))

        assert(snapshot)
        assert(snapshot.content.includes("<working_focus>"))
        assert(snapshot.content.includes("<associative_memory>"))
        assert(snapshot.content.includes("</associative_memory>"))

        snapshots.set(input, [...snapshots.get(input) ?? [], snapshot.content])

        const cycle = (cycles.get(input) ?? 0) + 1

        cycles.set(input, cycle)

        if (input === "recall first") {

            assert.deepEqual(request.tools.map(tool => tool.name), ["tools", "docs", "memory"])

            if (cycle === 1) {

                yield {
                    type: "tool-call" as const,
                    call: { id: "recall-memory", name: "memory", input: { query: "first", budget: 1_000 } }
                }

                return
            }

            const memoryResult = request.messages.find(message => message.role === "tool" && message.name === "memory")

            assert(memoryResult)

            const result = JSON.parse(memoryResult.content) as Record<string, unknown>

            assert(Array.isArray(result.output))

            assert(result.output.some(item => (
                typeof item === "object"
                && item !== null
                && "content" in item
                && String(item.content).includes("first")
            )))

            yield { type: "text" as const, content: "memory:complete" }

            return
        }

        if (input === "produce unique task failure") {

            throw new Error("unique task failure evidence")
        }

        if (input === "inspect unique task failure evidence") {

            assert(snapshot.content.includes('kind="task.failed"'))
            assert(snapshot.content.includes('method="task-failure"'))
            assert(snapshot.content.includes("Task failed: unique task failure evidence"))

            yield { type: "text" as const, content: "task-failure:recalled" }

            return
        }

        if (input === "produce missing capability failure") {

            if (cycle === 1) {

                yield {
                    type: "tool-call" as const,
                    call: { id: "missing-capability-call", name: "missing-capability", input: {} }
                }

                return
            }

            yield { type: "text" as const, content: "tool-failure:produced" }

            return
        }

        if (input === "inspect missing capability failure") {

            assert(snapshot.content.includes('kind="tool.result"'))
            assert(snapshot.content.includes('method="tool-result"'))
            assert(snapshot.content.includes('tool="missing-capability"'))
            assert(snapshot.content.includes('call="missing-capability-call"'))

            yield { type: "text" as const, content: "tool-failure:recalled" }

            return
        }

        if (cycle === 1) {

            assert.deepEqual(request.tools.map(tool => tool.name), ["tools", "docs", "memory"])

            await (input === "first" ? first.promise : second.promise)

            yield {
                type: "tool-call" as const,
                call: {
                    id: `${input}-tools`,
                    name: "tools",
                    input: {
                        names: ["time", "programs", "processes", "endpoints", "windows"]
                    }
                }
            }

            return
        }

        if (cycle === 2) {

            assert.deepEqual(request.tools.map(tool => tool.name), [
                "tools",
                "docs",
                "memory",
                "time",
                "programs",
                "processes",
                "endpoints",
                "windows"
            ])

            assert(request.messages.some(message => message.role === "tool" && message.name === "tools"))

            yield {
                type: "tool-call" as const,
                call: { id: `${input}-time-a`, name: "time", input: {} }
            }

            yield {
                type: "tool-call" as const,
                call: { id: `${input}-time-b`, name: "time", input: {} }
            }

            return
        }

        assert.equal(request.messages.filter(message => message.role === "tool" && message.name === "time").length, 2)

        yield { type: "text" as const, content: `${input}:complete` }
    }
}

const firstTask = await lemo.task({ input: "first", model })

const secondTask = await lemo.task({ input: "second", model })

assert.equal(await firstTask.status(), "running")

assert.equal(await secondTask.status(), "running")

first.resolve()

second.resolve()

assert.deepEqual(await Promise.all([firstTask.result(), secondTask.result()]), [
    "first:complete",
    "second:complete"
])

assert.equal(await firstTask.status(), "completed")

assert.equal(await secondTask.status(), "completed")

const operations = database.prepare(`
    SELECT sequence, id, task_id, parent_id, kind, payload
    FROM operations
    ORDER BY sequence
`).all()

assert.equal(operations.length, 40)

for (const task of [firstTask, secondTask]) {

    const related = operations.filter(operation => operation.task_id === task.id)

    assert.deepEqual(related.map(operation => operation.kind), [
        "task.input",
        "task.run.started",
        "cycle.started",
        "model.event",
        "model.message",
        "cycle.completed",
        "tool.tools.loaded",
        "tool.result",
        "cycle.started",
        "model.event",
        "model.event",
        "model.message",
        "cycle.completed",
        "tool.result",
        "tool.result",
        "cycle.started",
        "model.event",
        "model.message",
        "cycle.completed",
        "task.completed"
    ])

    assert.equal(related[0]?.parent_id, null)

    for (let index = 1; index < related.length; index++) {

        assert.equal(related[index]?.parent_id, related[index - 1]?.id)
    }
}

for (const [input, task] of [["first", firstTask], ["second", secondTask]] as const) {

    const recalled = snapshots.get(input)

    assert(recalled?.length)
    assert(recalled.every(snapshot => !snapshot.includes(`<episode task="${task.id}">`)))
    assert(recalled.some(snapshot => snapshot.includes('source="tool-result:tools"')))
}

const recordedInput = operations.find(operation => operation.task_id === firstTask.id)

assert.deepEqual(JSON.parse(String(recordedInput?.payload)), {
    model: { provider: "test", id: "test-model" },
    input: "first"
})

assert(!operations.some(operation => operation.kind === "model.request"))
assert(!operations.some(operation => String(operation.payload).includes("# Reconstructed Cycle Context")))

const memoryTask = await lemo.task({ input: "recall first", model })

assert.equal(await memoryTask.result(), "memory:complete")

const memoryOperations = await memoryTask.operations()

assert(memoryOperations.some(operation => operation.kind === "tool.memory.recalled"))

const memoryResult = memoryOperations.find(operation => operation.kind === "tool.result")

assert(memoryResult)

const memoryPayload = memoryResult.payload as Record<string, unknown>

assert(Array.isArray(memoryPayload.output))

assert(memoryPayload.output.every(item => (
    typeof item === "object"
    && item !== null
    && "kind" in item
    && "selection" in item
    && ["recent", "relevant", "context"].includes(String(item.selection))
)))

assert(memoryPayload.output.reduce((size, item) => (
    typeof item === "object" && item !== null && "content" in item
        ? size + String(item.content).length + 180
        : size
), 0) <= 1_000)

const failedTask = await lemo.task({ input: "produce unique task failure", model })

await assert.rejects(failedTask.result(), /unique task failure evidence/)

const failureContext = await lemo.task({ input: "inspect unique task failure evidence", model })

assert.equal(await failureContext.result(), "task-failure:recalled")

const toolFailure = await lemo.task({ input: "produce missing capability failure", model })

assert.equal(await toolFailure.result(), "tool-failure:produced")

const toolFailureContext = await lemo.task({ input: "inspect missing capability failure", model })

assert.equal(await toolFailureContext.result(), "tool-failure:recalled")

const restarted = await Lemo.wakeUp(database, client)

const restored = await restarted.findTask(firstTask.id)

assert(restored)

assert.notEqual(restored, firstTask)

assert.equal(await restored.status(), "completed")

assert.equal(await restored.result(), "first:complete")

assert.deepEqual(
    (await restored.operations()).map(operation => operation.id),
    (await firstTask.operations()).map(operation => operation.id)
)

assert.equal(await restarted.findTask("unknown"), null)

const compactSource = new DatabaseSync(":memory:")
const compactDatabase = await LemoDatabase.open(compactSource)

for (let index = 0; index < 20; index++) {

    await compactDatabase.createTask(`compact-${index}`, { input: `compact fact ${index}` })
}

const compact = await new Memory(compactDatabase).recall({ query: "compact", budget: 1_000 })

const largeSource = new DatabaseSync(":memory:")
const largeDatabase = await LemoDatabase.open(largeSource)

for (let index = 0; index < 5; index++) {

    await largeDatabase.createTask(`large-${index}`, {
        input: `large fact ${index} ${"content ".repeat(100)}`
    })
}

const large = await new Memory(largeDatabase).recall({ query: "large", budget: 1_000 })

assert(compact.length > large.length)

const continuitySource = new DatabaseSync(":memory:")
const continuityDatabase = await LemoDatabase.open(continuitySource)

await continuityDatabase.createTask("identity", { input: "My name is Zohayr" })
await continuityDatabase.appendToTask("identity", "model.message", {
    content: "Your name is Zohayr"
})

await continuityDatabase.createTask("long-operation", { input: "Open a browser" })

for (let index = 0; index < 12; index++) {

    await continuityDatabase.appendToTask("long-operation", "model.message", {
        content: `Browser operation ${index} ${"working ".repeat(30)}`
    })
}

const continuity = await new Memory(continuityDatabase).recall({
    query: "an unrelated follow-up",
    budget: 2_000
})

assert(continuity.some(result => result.task === "long-operation"))
assert(continuity.some(result => result.task === "identity"))

const fittingSource = new DatabaseSync(":memory:")
const fittingDatabase = await LemoDatabase.open(fittingSource)

await fittingDatabase.createTask("small", { input: "needle remains accessible" })
await fittingDatabase.createTask("oversized", { input: "large ".repeat(300) })

const fitting = await new Memory(fittingDatabase).recall({ query: "needle", budget: 1_000 })

assert(fitting.some(result => result.task === "small"))
assert(fitting.reduce((size, result) => size + result.content.length + 180, 0) <= 1_000)

const activationSource = new DatabaseSync(":memory:")
const activationDatabase = await LemoDatabase.open(activationSource)

await activationDatabase.createTask("recovery", {
    input: "Recover the browser after a websocket transport timeout"
})
await activationDatabase.createTask("recent-unrelated", {
    input: "Change the wallpaper color"
})

const activated = await new Memory(activationDatabase).recall({
    query: "Investigate the current failure",
    focus: [{
        source: "tool-result:endpoints",
        content: "The websocket transport timed out while opening the browser",
        weight: 2.4
    }],
    budget: 1_000
})

assert(activated.some(result => result.task === "recovery" && result.selection === "relevant"))

const toolResultSource = new DatabaseSync(":memory:")
const toolResultDatabase = await LemoDatabase.open(toolResultSource)
const workspaceIdentity = "bd4e05ac-b3bd-4f53-83b0-d641f717ed19"

await toolResultDatabase.createTask("workspace-history", { input: "Inspect old browser workspaces" })
await toolResultDatabase.appendToTask("workspace-history", "tool.result", {
    call: "workspace-list",
    name: "endpoints",
    ok: true,
    output: { workspaces: [{ workspace: workspaceIdentity }], transport: "raw-preserved" },
    modelOutput: { workspaces: [{ workspace: workspaceIdentity }] }
})

const toolResultContext = await new Memory(toolResultDatabase).recall({
    query: "Find the old browser workspace",
    budget: 1_000
})

assert(toolResultContext.some(result => (
    result.method === "tool-result"
    && result.tool === "endpoints"
    && result.content.includes(workspaceIdentity)
)))

const storedToolResult = (await toolResultDatabase.operations("workspace-history"))
    .find(operation => operation.kind === "tool.result")

assert.deepEqual((storedToolResult?.payload as Record<string, unknown>).output, {
    workspaces: [{ workspace: workspaceIdentity }],
    transport: "raw-preserved"
})

database.close()
compactSource.close()
largeSource.close()
continuitySource.close()
fittingSource.close()
activationSource.close()
toolResultSource.close()

function deferred() {

    let resolve!: () => void

    const promise = new Promise<void>(done => {

        resolve = done
    })

    return { promise, resolve }
}
