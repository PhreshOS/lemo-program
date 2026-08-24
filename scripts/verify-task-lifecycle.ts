import assert from "node:assert/strict"
import { DatabaseSync } from "node:sqlite"
import type ClientChannel from "../source/server/core/client-channel"
import LemoDatabase from "../source/server/core/lemo/database"
import Lemo from "../source/server/core/lemo/lemo"
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
