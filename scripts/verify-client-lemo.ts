import assert from "node:assert/strict"
import Lemo, { type LemoSource } from "../source/client/core/lemo/lemo"
import type { TaskSnapshot } from "../source/server/core/lemo/task"
import type LLMModel from "../source/client/core/llm/model"
import type LLMProvider from "../source/client/core/llm/provider"

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

        return { snapshot: initial, events, close: events.close }
    },
    async open() {

        return { snapshot: initial, events, close: events.close }
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

async function settled() {

    await Promise.resolve()

    await Promise.resolve()
}
