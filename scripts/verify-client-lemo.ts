import assert from "node:assert/strict"
import Lemo, { type LemoSource } from "../source/client/core/lemo/lemo"
import Tool from "../source/client/core/lemo/tool"
import type { TaskSnapshot } from "../source/server/core/lemo/task"
import type LLMModel from "../source/client/core/llm/model"
import type LLMProvider from "../source/client/core/llm/provider"

const responses: { task: string; call: string; response: unknown }[] = []

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
    control(task) {

        return controlFor(task)
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
    async *generate() { return null }
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
    id: "spaced-text",
    task: task.id,
    parent: "text",
    kind: "model.event",
    payload: { type: "text", content: " there" },
    createdAt: 3
})

events.push({
    sequence: 4,
    id: "cycle-complete",
    task: task.id,
    parent: "spaced-text",
    kind: "cycle.completed",
    payload: {
        usage: {
            input: { tokens: 100, cachedTokens: 50 },
            output: { tokens: 20, reasoningTokens: 5 }
        }
    },
    createdAt: 4
})

events.push({
    sequence: 5,
    id: "complete",
    task: task.id,
    parent: "cycle-complete",
    kind: "task.completed",
    payload: { output: "Hi there" },
    createdAt: 5
})

await settled()

assert.equal(task.status, "completed")

assert.equal(task.operations().length, 5)

const outputEvent = task.timeline().find(event => event.type === "output")

assert(outputEvent?.type === "output")
assert.equal(outputEvent.content, "Hi there")

const usageEvent = task.timeline().find(event => event.type === "usage")

assert(usageEvent?.type === "usage")
assert.deepEqual(usageEvent.usage, {
    input: { tokens: 100, cachedTokens: 50 },
    output: { tokens: 20, reasoningTokens: 5 }
})

assert.notEqual(task.operations(), initialOperations)

assert.equal(task.operations(), task.operations())

assert.equal(changes, 4)

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

projectionEvents.push({
    sequence: 401,
    id: "prompt-call",
    task: "active-latest",
    parent: "active-latest-input",
    kind: "model.event",
    payload: {
        type: "tool-call",
        call: {
            id: "call-one",
            name: "prompt",
            input: {
                type: "form",
                content: "Continue?",
                fields: [{ type: "confirmation", key: "continue", label: "Continue", required: true }]
            }
        }
    },
    createdAt: 201
})

await settled()

const projectedTask = projected.tasks().find(task => task.id === "active-latest")!
const promptEvent = projectedTask.timeline().find(event => event.type === "tool")

assert(promptEvent?.type === "tool")

const prompt = promptEvent.tool
const runningPrompt = prompt.snapshot()

assert(prompt instanceof Tool)
assert.equal(prompt.name, "prompt")
assert.equal(runningPrompt.status, "running")

projectionEvents.push({
    sequence: 402,
    id: "prompt-waiting",
    task: "active-latest",
    parent: "prompt-call",
    kind: "tool.prompt.waiting",
    payload: {
        call: "call-one",
        payload: {
            expiresAt: 10_000
        }
    },
    createdAt: 202
})

await settled()

assert.notEqual(prompt.snapshot(), runningPrompt)
assert.equal(prompt.snapshot().status, "waiting")
assert.equal(prompt.status, "waiting")
assert.equal(projectedTask.timeline(), projectedTask.timeline())

await prompt.respond({ type: "submitted", values: { continue: true } })

assert.deepEqual(responses.at(-1), {
    task: "active-latest",
    call: "call-one",
    response: { type: "submitted", values: { continue: true } }
})

projectionEvents.push({
    sequence: 403,
    id: "prompt-result",
    task: "active-latest",
    parent: "prompt-waiting",
    kind: "tool.result",
    payload: { call: "call-one", name: "prompt", ok: true, output: { type: "submitted" } },
    createdAt: 203
})

await settled()

const completedPrompt = projectedTask.timeline().find(event => event.type === "tool")

assert(completedPrompt?.type === "tool")
assert.equal(completedPrompt.tool, prompt)
assert.equal(prompt.status, "completed")

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

function controlFor(task = "") {

    return {
        async pause() {},
        async cancel() {},
        async continue() {},
        async respond(call: string, response: unknown) { responses.push({ task, call, response }) },
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

    await new Promise<void>(resolve => setImmediate(resolve))
}
