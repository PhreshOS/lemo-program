import assert from "node:assert/strict"
import { DatabaseSync } from "node:sqlite"
import type { PromptEvent, PromptRecord } from "../source/client/core/prompts/contract"
import type ClientChannel from "../source/server/core/client-channel"
import Lemo from "../source/server/core/lemo/lemo"
import type LLMModel from "../source/server/core/llm/model"
import type LLMProvider from "../source/server/core/llm/provider"

const database = new DatabaseSync(":memory:")
const client = channel()
const lemo = await Lemo.wakeUp(database, client)

let cycle = 0
let model!: LLMModel

const provider: LLMProvider = {
    identity: "test",
    name: "Test",
    active: true,
    async models() { return [model] }
}

model = {
    id: "test",
    provider,
    async *generate(request) {

        cycle++

        if (cycle === 1) {
            yield {
                type: "tool-call" as const,
                call: { id: "load-prompt", name: "tools", input: { names: ["prompt"] } }
            }

            return
        }

        if (cycle === 2) {
            assert(request.tools.some(tool => tool.name === "prompt"))

            yield {
                type: "tool-call" as const,
                call: { id: "request-name", name: "prompt", input: { content: "What is your name?" } }
            }

            return
        }

        const result = request.messages.findLast(message => message.role === "tool" && message.name === "prompt")

        assert(result)
        assert.deepEqual(JSON.parse(result.content).output, { answer: "Zohayr" })

        yield { type: "text" as const, content: "Thank you, Zohayr." }
    }
}

const task = await lemo.task({ input: "Ask for my name", model })
const opened = await client.waitFor("lemo.prompt.open") as PromptRecord

assert.equal(opened.task, task.id)
assert.equal(opened.call, "request-name")
assert.equal(opened.content, "What is your name?")
assert(opened.expiresAt > opened.createdAt)

client.receive("lemo.prompt.ready", { client: "reloaded-client" })

assert.equal(client.published.filter(event => event.name === "lemo.prompt.open").length, 2)

client.receive("lemo.prompt.response", { id: opened.id, content: "Zohayr" })

assert.equal(await task.result(), "Thank you, Zohayr.")

const released = client.published.find(event => event.name === "lemo.prompt.release")

assert.deepEqual(released?.payload, { id: opened.id, reason: "answered" })

database.close()

const pausedDatabase = new DatabaseSync(":memory:")
const pausedClient = channel()
const pausedLemo = await Lemo.wakeUp(pausedDatabase, pausedClient)
let pausedCycle = 0

const pausedModel: LLMModel = {
    id: "paused",
    provider,
    async *generate() {

        pausedCycle++

        if (pausedCycle === 1) {
            yield {
                type: "tool-call" as const,
                call: { id: "load-paused-prompt", name: "tools", input: { names: ["prompt"] } }
            }

            return
        }

        yield {
            type: "tool-call" as const,
            call: { id: "paused-prompt", name: "prompt", input: { content: "Still there?" } }
        }
    }
}

const pausedTask = await pausedLemo.task({ input: "Wait for me", model: pausedModel })
const pending = await pausedClient.waitFor("lemo.prompt.open") as PromptRecord

await pausedTask.pause()

assert.equal(await pausedTask.status(), "paused")
assert(pausedClient.published.some(event => (
    event.name === "lemo.prompt.release"
    && (event.payload as { id?: string }).id === pending.id
    && (event.payload as { reason?: string }).reason === "cancelled"
)))
assert((await pausedTask.operations()).some(operation => (
    operation.kind === "tool.result"
    && (operation.payload as { call?: string }).call === "paused-prompt"
)))

pausedDatabase.close()

function channel() {

    const subscribers = new Map<string, Set<(value: unknown) => void>>()
    const waiting = new Map<string, ((value: unknown) => void)[]>()
    const published: { name: string; payload: unknown }[] = []

    const source: ClientChannel & {
        published: typeof published
        receive(event: PromptEvent, payload: unknown): void
        waitFor(event: PromptEvent): Promise<unknown>
    } = {
        published,
        publish(name, payload) {

            published.push({ name, payload })

            waiting.get(name)?.shift()?.(payload)
        },
        subscribe(name, subscriber) {

            const listeners = subscribers.get(name) ?? new Set()

            listeners.add(subscriber)
            subscribers.set(name, listeners)

            return () => listeners.delete(subscriber)
        },
        receive(name, payload) {

            for (const subscriber of subscribers.get(name) ?? []) subscriber(payload)
        },
        waitFor(name) {

            const existing = published.find(event => event.name === name)

            if (existing) return Promise.resolve(existing.payload)

            return new Promise(resolve => {

                const listeners = waiting.get(name) ?? []

                listeners.push(resolve)
                waiting.set(name, listeners)
            })
        }
    }

    return source
}
