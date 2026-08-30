import assert from "node:assert/strict"
import { access, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import Lemo from "../source/server/core/lemo/lemo"
import type Operation from "../source/server/core/lemo/operation"
import type Task from "../source/server/core/lemo/task"
import type LLMModel from "../source/server/core/llm/model"
import type LLMProvider from "../source/server/core/llm/provider"

const database = new DatabaseSync(":memory:")
const lemo = await Lemo.wakeUp(database)

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
const opened = await waitForOperation(task, "tool.prompt.waiting", "request-name")
const openedState = payload(opened)

assert.equal(opened.task, task.id)
assert.equal("request" in openedState, false)
assert((openedState.expiresAt as number) > opened.createdAt)

assert.throws(() => lemo.respond(task.id, "request-name", {
    type: "submitted",
    values: { name: "" }
}), /must be text/)

lemo.respond(task.id, "request-name", {
    type: "submitted",
    values: { name: "Zohayr" }
})

const html = await waitForOperation(task, "tool.prompt.waiting", "request-choice")

assert.equal("request" in payload(html), false)

lemo.respond(task.id, "request-choice", {
    type: "submitted",
    values: { choice: "first" }
})

assert.equal(await task.result(), "Thank you, Zohayr.")

database.close()

const pausedDatabase = new DatabaseSync(":memory:")
const pausedLemo = await Lemo.wakeUp(pausedDatabase)
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
await waitForOperation(pausedTask, "tool.prompt.waiting", "paused-prompt")

await pausedTask.pause()

assert.equal(await pausedTask.status(), "paused")
assert((await pausedTask.operations()).some(operation => (
    operation.kind === "tool.result"
    && (operation.payload as { call?: string }).call === "paused-prompt"
)))

pausedDatabase.close()

const approvalRoot = await mkdtemp(join(tmpdir(), "lemo-approval-"))
const approvalTarget = join(approvalRoot, "delete-me.txt")

await writeFile(approvalTarget, "temporary", "utf8")

const approvalDatabase = new DatabaseSync(":memory:")
const approvalLemo = await Lemo.wakeUp(approvalDatabase)
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
const optionalApproval = await waitForOperation(
    approvalTask,
    "tool.time.approval.requested",
    "approved-time"
)
const optionalRequest = payload(optionalApproval).request as Record<string, unknown>

assert.equal(optionalRequest.type, "approval")

assert.throws(() => approvalLemo.respond(approvalTask.id, "approved-time", {
    type: "submitted",
    values: {}
}))

approvalLemo.respond(approvalTask.id, "approved-time", { type: "rejected" })

const mandatoryApproval = await waitForOperation(
    approvalTask,
    "tool.files.approval.requested",
    "mandatory-delete"
)
const mandatoryRequest = payload(mandatoryApproval).request as Record<string, unknown>

assert.equal(mandatoryRequest.type, "approval")
assert.match(String(mandatoryRequest.content), /delete-me\.txt/)

approvalLemo.respond(approvalTask.id, "mandatory-delete", { type: "approved" })

assert.equal(await approvalTask.result(), "Approval flow complete.")

const approvalOperations = await approvalTask.operations()

assert(approvalOperations.some(operation => operation.kind === "tool.time.approval.rejected"))
assert(approvalOperations.some(operation => operation.kind === "tool.files.approval.approved"))

approvalDatabase.close()
await rm(approvalRoot, { recursive: true, force: true })

async function waitForOperation(task: Task, kind: string, call: string): Promise<Operation> {

    const find = async () => (await task.operations()).find(operation => (
        operation.kind === kind
        && (operation.payload as { call?: string }).call === call
    ))
    const existing = await find()

    if (existing) return existing

    return new Promise(resolve => {

        const unsubscribe = task.subscribe(() => {

            void find().then(operation => {

                if (!operation) return

                unsubscribe()
                resolve(operation)
            })
        })
    })
}

function payload(operation: Operation) {

    return (operation.payload as { payload: Record<string, unknown> }).payload
}
