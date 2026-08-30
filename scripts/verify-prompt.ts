import assert from "node:assert/strict"
import { access, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
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
    reasoning: null,
    async contextWindow() { return null },
    async reasoningLevels() { return null },
    async setReasoning() {},
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
                call: {
                    id: "request-name",
                    name: "prompt",
                    input: {
                        type: "form",
                        title: "Identity",
                        content: "What is your name?",
                        fields: [{ type: "text", key: "name", label: "Name", required: true }]
                    }
                }
            }

            return
        }

        if (cycle === 3) {
            const result = request.messages.findLast(message => message.role === "tool" && message.name === "prompt")

            assert(result)
            assert.deepEqual(JSON.parse(result.content).output, {
                type: "submitted",
                values: { name: "Zohayr" }
            })

            yield {
                type: "tool-call" as const,
                call: {
                    id: "request-choice",
                    name: "prompt",
                    input: {
                        type: "html",
                        title: "Choose",
                        html: "<button onclick=\"form.set('choice', 'first'); form.submit()\">First</button>"
                    }
                }
            }

            return
        }

        const result = request.messages.findLast(message => message.role === "tool" && message.name === "prompt")

        assert(result)
        assert.deepEqual(JSON.parse(result.content).output, {
            type: "submitted",
            values: { choice: "first" }
        })

        yield { type: "text" as const, content: "Thank you, Zohayr." }
    }
}

const task = await lemo.task({ input: "Ask for my name", model })
const opened = await client.waitFor("lemo.prompt.open") as PromptRecord

assert.equal(opened.task, task.id)
assert.equal(opened.call, "request-name")
assert.equal(opened.request.type, "form")
assert.equal(opened.request.content, "What is your name?")
assert(opened.expiresAt > opened.createdAt)

client.receive("lemo.prompt.ready", { client: "reloaded-client" })

assert.equal(client.published.filter(event => event.name === "lemo.prompt.open").length, 2)

client.receive("lemo.prompt.response", {
    id: opened.id,
    type: "submitted",
    values: { name: "" }
})

assert(client.published.some(event => (
    event.name === "lemo.prompt.invalid"
    && (event.payload as { id?: string }).id === opened.id
)))

client.receive("lemo.prompt.response", {
    id: opened.id,
    type: "submitted",
    values: { name: "Zohayr" }
})

const html = await client.waitFor("lemo.prompt.open", 2) as PromptRecord

assert.equal(html.call, "request-choice")
assert.equal(html.request.type, "html")

client.receive("lemo.prompt.response", {
    id: html.id,
    type: "submitted",
    values: { choice: "first" }
})

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
    reasoning: null,
    async contextWindow() { return null },
    async reasoningLevels() { return null },
    async setReasoning() {},
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
            call: {
                id: "paused-prompt",
                name: "prompt",
                input: {
                    type: "form",
                    content: "Still there?",
                    fields: [{ type: "confirmation", key: "present", label: "I am here", required: true }]
                }
            }
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

const approvalRoot = await mkdtemp(join(tmpdir(), "lemo-approval-"))
const approvalTarget = join(approvalRoot, "delete-me.txt")

await writeFile(approvalTarget, "temporary", "utf8")

const approvalDatabase = new DatabaseSync(":memory:")
const approvalClient = channel()
const approvalLemo = await Lemo.wakeUp(approvalDatabase, approvalClient)
let approvalCycle = 0
let approvalModel!: LLMModel

const approvalProvider: LLMProvider = {
    identity: "approval-test",
    name: "Approval Test",
    active: true,
    async models() { return [approvalModel] }
}

approvalModel = {
    id: "approval-test",
    provider: approvalProvider,
    reasoning: null,
    async contextWindow() { return null },
    async reasoningLevels() { return null },
    async setReasoning() {},
    async *generate(request) {

        approvalCycle++

        if (approvalCycle === 1) {
            yield {
                type: "tool-call" as const,
                call: { id: "load-approval-tools", name: "tools", input: { names: ["time", "files"] } }
            }

            return
        }

        if (approvalCycle === 2) {
            const definition = request.tools.find(tool => tool.name === "time")

            assert(definition)
            assert.match(JSON.stringify(definition.parameters), /"approval"/)

            yield {
                type: "tool-call" as const,
                call: {
                    id: "approved-time",
                    name: "time",
                    input: { approval: "true" }
                }
            }

            return
        }

        if (approvalCycle === 3) {
            const result = request.messages.findLast(message => message.role === "tool" && message.name === "time")

            assert(result)
            assert.equal(JSON.parse(result.content).ok, false)

            yield {
                type: "tool-call" as const,
                call: {
                    id: "mandatory-delete",
                    name: "files",
                    input: { action: "delete", path: approvalTarget }
                }
            }

            return
        }

        await assert.rejects(access(approvalTarget), /ENOENT/)
        yield { type: "text" as const, content: "Approval flow complete." }
    }
}

const approvalTask = await approvalLemo.task({ input: "Test approval", model: approvalModel })
const optionalApproval = await approvalClient.waitFor("lemo.prompt.open") as PromptRecord

assert.equal(optionalApproval.request.type, "approval")
assert.equal(optionalApproval.call, "approved-time")

approvalClient.receive("lemo.prompt.response", { id: optionalApproval.id, type: "rejected" })

const mandatoryApproval = await approvalClient.waitFor("lemo.prompt.open", 1) as PromptRecord

assert.equal(mandatoryApproval.request.type, "approval")
assert.equal(mandatoryApproval.call, "mandatory-delete")
assert.match(mandatoryApproval.request.content, /delete-me\.txt/)

approvalClient.receive("lemo.prompt.response", { id: mandatoryApproval.id, type: "approved" })

assert.equal(await approvalTask.result(), "Approval flow complete.")

const approvalOperations = await approvalTask.operations()

assert(approvalOperations.some(operation => operation.kind === "tool.time.approval.rejected"))
assert(approvalOperations.some(operation => operation.kind === "tool.files.approval.approved"))

approvalDatabase.close()
await rm(approvalRoot, { recursive: true, force: true })

function channel() {

    const subscribers = new Map<string, Set<(value: unknown) => void>>()
    const waiting = new Map<string, ((value: unknown) => void)[]>()
    const published: { name: string; payload: unknown }[] = []

    const source: ClientChannel & {
        published: typeof published
        receive(event: PromptEvent, payload: unknown): void
        waitFor(event: PromptEvent, occurrence?: number): Promise<unknown>
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
        waitFor(name, occurrence = 0) {

            const existing = published.filter(event => event.name === name)[occurrence]

            if (existing) return Promise.resolve(existing.payload)

            return new Promise(resolve => {

                const listeners = waiting.get(name) ?? []

                listeners.push(() => {
                    const events = published.filter(event => event.name === name)

                    if (events.length > occurrence) resolve(events[occurrence]?.payload)
                    else listeners.push(resolve)
                })
                waiting.set(name, listeners)
            })
        }
    }

    return source
}
