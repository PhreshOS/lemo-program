import assert from "node:assert/strict"
import { DatabaseSync } from "node:sqlite"
import type ClientChannel from "../source/server/core/client-channel"
import LemoDatabase from "../source/server/core/lemo/database"
import Lemo from "../source/server/core/lemo/lemo"
import type Task from "../source/server/core/lemo/task"
import type LLMModel from "../source/server/core/llm/model"
import type LLMProvider from "../source/server/core/llm/provider"

const client: ClientChannel = {
    publish() {},
    subscribe() { return () => {} }
}

const database = new DatabaseSync(":memory:")
const lemo = await Lemo.wakeUp(database, client)
const entered = signals()
const calls = new Map<string, number>()

let model!: LLMModel

const provider: LLMProvider = {
    identity: "test",
    name: "Test",
    active: true,
    async models() { return [model] }
}

model = {
    id: "lifecycle",
    provider,
    reasoning: null,
    async contextWindow() { return null },
    async reasoningLevels() { return null },
    async setReasoning() {},
    async *generate(request) {

        const input = request.messages.find(message => message.role === "user")?.content ?? ""
        const call = (calls.get(input) ?? 0) + 1

        calls.set(input, call)
        entered.open(input)

        if (call === 1) await new Promise<void>(() => {})

        yield { type: "text" as const, content: `${input}:continued` }
    }
}

const paused = await lemo.task({ input: "pause-me", model })

await entered.wait("pause-me")
await paused.pause()

assert.equal(await paused.status(), "paused")
assert.equal((await paused.operations()).at(-1)?.kind, "task.paused")

await paused.continue(model)

assert.equal(await paused.result(), "pause-me:continued")
assert.equal(await paused.status(), "completed")

const cancelled = await lemo.task({ input: "cancel-me", model })

await entered.wait("cancel-me")
await cancelled.cancel()

assert.equal(await cancelled.status(), "cancelled")
await assert.rejects(cancelled.result(), /cancelled/)

const capacity: Task[] = []

for (let index = 0; index < 10; index++) {

    capacity.push(await lemo.task({ input: `capacity-${index}`, model }))
}

await assert.rejects(
    lemo.task({ input: "capacity-overflow", model }),
    /at most 10 running or paused Tasks/
)

await capacity[0]!.pause()

await assert.rejects(
    lemo.task({ input: "paused-capacity-overflow", model }),
    /at most 10 running or paused Tasks/
)

await capacity[0]!.cancel()

const replacement = await lemo.task({ input: "capacity-replacement", model })

for (const task of [...capacity.slice(1), replacement]) await task.cancel()

database.close()

const recoverySource = new DatabaseSync(":memory:")
const raw = await LemoDatabase.open(recoverySource)

await raw.createTask("orphan", {
    input: "unfinished",
    model: { provider: "test", id: "lifecycle" }
})
await raw.appendToTask("orphan", "task.run.started", {
    run: "dead-run",
    reason: "created",
    model: { provider: "test", id: "lifecycle" }
})

const recovered = await Lemo.wakeUp(recoverySource, client)
const orphan = await recovered.findTask("orphan")

assert(orphan)
assert.equal(await orphan.status(), "paused")
assert.deepEqual((await orphan.operations()).at(-1)?.payload, {
    run: "dead-run",
    reason: "interrupted"
})

for (let index = 0; index < 25; index++) {

    const identity = `completed-${String(index).padStart(2, "0")}`

    await raw.createTask(identity, { input: identity })
    await raw.appendToTask(identity, "task.completed", { output: identity })
}

await raw.createTask("failed-client-task", { input: "failed-client-task" })
await raw.appendToTask("failed-client-task", "task.failed", { message: "failed" })

const firstPage = await raw.tasks({
    limit: 5,
    statuses: ["completed"],
    search: "completed",
    order: "newest"
})

assert.equal(firstPage.tasks.length, 5)
assert(firstPage.next)

const secondPage = await raw.tasks({
    limit: 5,
    cursor: firstPage.next,
    statuses: ["completed"],
    search: "completed",
    order: "newest"
})

assert.equal(secondPage.tasks.length, 5)
assert(!secondPage.tasks.some(task => firstPage.tasks.some(first => first.id === task.id)))

const clientTasks = await recovered.taskProjection()

assert.equal(clientTasks.length, 21)
assert.equal(await clientTasks[0]!.status(), "paused")
const clientTaskStatuses = await Promise.all(clientTasks.map(task => task.status()))

assert.equal(clientTaskStatuses.filter(status => status !== "running" && status !== "paused").length, 20)
assert(clientTasks.some(task => task.id === "failed-client-task"))

recoverySource.close()

function signals() {

    const opened = new Set<string>()
    const waiting = new Map<string, () => void>()

    return {
        open(name: string) {

            opened.add(name)
            waiting.get(name)?.()
            waiting.delete(name)
        },
        wait(name: string) {

            if (opened.has(name)) return Promise.resolve()

            return new Promise<void>(resolve => waiting.set(name, resolve))
        }
    }
}
