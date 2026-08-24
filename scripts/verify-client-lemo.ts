import assert from "node:assert/strict"
import Lemo, { type LemoSource } from "../source/client/core/lemo/lemo"
import type { TaskSnapshot } from "../source/server/core/lemo/task"
import type LLMModel from "../source/client/core/llm/model"
import type LLMProvider from "../source/client/core/llm/provider"
import Prompts, { type PromptSource } from "../source/client/core/prompts/prompts"

const events = channel()

const initial: TaskSnapshot = {
    id: "task-one",
    status: "running",
    operations: [{
        sequence: 1,
        id: "input",
        task: "task-one",
        parent: null,
        kind: "task.input",
        payload: { input: "Hello", model: { provider: "test", id: "model" } },
        createdAt: 1
    }]
}

const source: LemoSource = {
    async snapshots() {

        return []
    },
    async create() {

        return channelFor(initial, events)
    },
    async open() {

        return channelFor(initial, events)
    }
}

let model!: LLMModel

const provider: LLMProvider = {
    identity: "test",
    name: "Test",
    async configured() {

        return true
    },
    async active() {

        return true
    },
    async activate() {},
    async deactivate() {},
    async models() {

        return [model]
    }
}

model = {
    id: "model",
    provider,
    async *generate() {}
}

const lemo = new Lemo(source)

const task = await lemo.task({ input: "Hello", model })

let changes = 0

task.subscribe(() => changes++)

events.push({
    sequence: 2,
    id: "text",
    task: task.id,
    parent: "input",
    kind: "model.event",
    payload: { type: "text", content: "Hi" },
    createdAt: 2
})

events.push({
    sequence: 3,
    id: "complete",
    task: task.id,
    parent: "text",
    kind: "task.completed",
    payload: { output: "Hi" },
    createdAt: 3
})

await settled()

assert.equal(task.status, "completed")

assert.equal(task.operations().length, 3)

assert.equal(changes, 2)

const restored = new Lemo({
    ...source,
    async snapshots() {

        return [{ ...initial, status: "completed", operations: task.operations() }]
    }
})

const tasks = await restored.tasks()

assert.equal(tasks.length, 1)

assert.equal(tasks[0]?.status, "completed")

const promptListeners = new Set<(value: unknown) => void>()
let ready = 0

const promptSource: PromptSource = {
    open(listener) {

        promptListeners.add(listener)

        return () => { promptListeners.delete(listener) }
    },
    release() {

        return () => {}
    },
    respond() {},
    ready() { ready++ }
}

const prompts = new Prompts(promptSource)

prompts.start()

assert.equal(ready, 1)
assert.equal(promptListeners.size, 1)

prompts.stop()

assert.equal(promptListeners.size, 0)

prompts.start()

assert.equal(ready, 2)
assert.equal(promptListeners.size, 1)

for (const listener of promptListeners) listener({
    id: "prompt-one",
    task: "task-one",
    call: "call-one",
    content: "Continue?",
    createdAt: 1,
    expiresAt: 2
})

assert.equal(prompts.forTask("task-one")[0]?.content, "Continue?")

prompts.stop()

function channel() {

    const values: unknown[] = []
    const waiting: ((result: IteratorResult<unknown>) => void)[] = []
    let closed = false

    return {
        push(value: unknown) {

            const resolve = waiting.shift()

            if (resolve) resolve({ value, done: false })
            else values.push(value)
        },
        close() {

            closed = true

            for (const resolve of waiting.splice(0)) resolve({ value: undefined, done: true })
        },
        [Symbol.asyncIterator]() {

            return {
                next(): Promise<IteratorResult<unknown>> {

                    const value = values.shift()

                    if (value !== undefined) return Promise.resolve({ value, done: false })

                    if (closed) return Promise.resolve({ value: undefined, done: true })

                    return new Promise(resolve => waiting.push(resolve))
                }
            }
        }
    }
}

function channelFor(snapshot: TaskSnapshot, events: ReturnType<typeof channel>) {

    return {
        snapshot,
        events,
        close: events.close,
        async pause() { return { ...snapshot, status: "paused" as const } },
        async cancel() { return { ...snapshot, status: "cancelled" as const } },
        async continue() { return { ...snapshot, status: "running" as const } }
    }
}

async function settled() {

    await Promise.resolve()

    await Promise.resolve()
}
