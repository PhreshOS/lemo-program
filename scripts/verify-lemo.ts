import assert from "node:assert/strict"
import { DatabaseSync } from "node:sqlite"
import Lemo from "../source/server/core/lemo/lemo"
import type LLMModel from "../source/server/core/llm/model"
import type LLMProvider from "../source/server/core/llm/provider"

const database = new DatabaseSync(":memory:")

const lemo = await Lemo.wakeUp(database)

assert(lemo instanceof Lemo)

await Lemo.wakeUp(database)

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

        const cycle = (cycles.get(input) ?? 0) + 1

        cycles.set(input, cycle)

        if (cycle === 1) {

            assert.deepEqual(request.tools.map(tool => tool.name), ["tools", "docs"])

            await (input === "first" ? first.promise : second.promise)

            yield {
                type: "tool-call" as const,
                call: { id: `${input}-tools`, name: "tools", input: { names: ["time"] } }
            }

            return
        }

        if (cycle === 2) {

            assert.deepEqual(request.tools.map(tool => tool.name), ["tools", "docs", "time"])

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

assert.equal(operations.length, 44)

for (const task of [firstTask, secondTask]) {

    const related = operations.filter(operation => operation.task_id === task.id)

    assert.deepEqual(related.map(operation => operation.kind), [
        "task.input",
        "cycle.started",
        "model.request",
        "model.event",
        "model.message",
        "cycle.completed",
        "tool.tools.loaded",
        "tool.result",
        "cycle.started",
        "model.request",
        "model.event",
        "model.event",
        "model.message",
        "cycle.completed",
        "tool.result",
        "tool.result",
        "cycle.started",
        "model.request",
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

const recordedInput = operations.find(operation => operation.task_id === firstTask.id)

assert.deepEqual(JSON.parse(String(recordedInput?.payload)), {
    model: { provider: "test", id: "test-model" },
    input: "first"
})

const recordedRequest = operations.find(operation => (
    operation.task_id === firstTask.id && operation.kind === "model.request"
))

const request = JSON.parse(String(recordedRequest?.payload)) as Record<string, unknown>

assert(Array.isArray(request.messages))

assert(Array.isArray(request.tools))

assert.equal(request.tools.length, 2)

const restarted = await Lemo.wakeUp(database)

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

database.close()

function deferred() {

    let resolve!: () => void

    const promise = new Promise<void>(done => {

        resolve = done
    })

    return { promise, resolve }
}
