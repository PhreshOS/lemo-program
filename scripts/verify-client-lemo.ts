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
    before: null,
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
    async observe() {

        return { snapshots: [], events, close: events.close }
    },
    async create(command) {

        events.push({
            ...initial.operations[0],
            payload: {
                ...(initial.operations[0]?.payload as Record<string, unknown>),
                command
            }
        })
    },
    control() {

        return controlFor()
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
    },
    model() {

        return model
    }
}

model = {
    id: "model",
    provider,
    reasoning: null,
    async contextWindow() { return null },
    async reasoningLevels() { return null },
    async setReasoning() {},
    async *generate() {}
}

const lemo = new Lemo(source)

const task = await lemo.task({ input: "Hello", model })

let changes = 0

const initialOperations = task.operations()

assert.equal(task.operations(), initialOperations)

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

assert.notEqual(task.operations(), initialOperations)

assert.equal(task.operations(), task.operations())

assert.equal(changes, 2)

const restored = new Lemo({
    ...source,
    async observe() {

        return {
            snapshots: [{ ...initial, status: "completed", operations: task.operations() }],
            events: channel(),
            close() {}
        }
    }
})

const tasks = await restored.start()

assert.equal(tasks.length, 1)

assert.equal(tasks[0]?.status, "completed")

const projectionEvents = channel()
const projectionSnapshots = [
    snapshot("active-old", "paused", 10),
    snapshot("active-new", "running", 20),
    ...Array.from({ length: 22 }, (_, index) => snapshot(
        `terminal-${index}`,
        index % 3 === 0 ? "failed" : index % 3 === 1 ? "cancelled" : "completed",
        100 + index
    ))
]
const projected = new Lemo({
    ...source,
    async observe() {

        return {
            snapshots: projectionSnapshots,
            events: projectionEvents,
            close: projectionEvents.close
        }
    }
})

await projected.start()

assert.deepEqual(projected.tasks().slice(0, 2).map(task => task.id), ["active-new", "active-old"])
assert.equal(projected.tasks().length, 22)
assert(projected.tasks().slice(2).some(task => task.status === "failed"))

projectionEvents.push(snapshot("active-latest", "running", 200).operations[0])

await settled()

assert.equal(projected.tasks()[0]?.id, "active-latest")

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
    invalid() {

        return () => {}
    },
    respond() {},
    ready() { ready++ }
}

const prompts = new Prompts(promptSource)

const initialPrompts = prompts.all()

assert.equal(prompts.all(), initialPrompts)

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
    request: {
        type: "form",
        content: "Continue?",
        fields: [{ type: "confirmation", key: "continue", label: "Continue", required: true }]
    },
    createdAt: 1,
    expiresAt: 2
})

assert.equal(prompts.forTask("task-one")[0]?.request.type, "form")

assert.notEqual(prompts.all(), initialPrompts)

assert.equal(prompts.all(), prompts.all())

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

function controlFor() {

    return {
        async pause() {},
        async cancel() {},
        async continue() {},
        async history() { return { operations: [], next: null } }
    }
}

function snapshot(id: string, status: TaskSnapshot["status"], createdAt: number): TaskSnapshot {

    const input = {
        sequence: createdAt * 2,
        id: `${id}-input`,
        task: id,
        parent: null,
        kind: "task.input",
        payload: { input: id, model: { provider: "test", id: "model" } },
        createdAt
    }
    const lifecycle = status === "running" ? [] : [{
        sequence: createdAt * 2 + 1,
        id: `${id}-${status}`,
        task: id,
        parent: input.id,
        kind: `task.${status}`,
        payload: {},
        createdAt: createdAt + 1
    }]

    return {
        id,
        status,
        before: null,
        operations: [input, ...lifecycle]
    }
}

async function settled() {

    await Promise.resolve()

    await Promise.resolve()
}
