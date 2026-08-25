import assert from "node:assert/strict"
import type { Process, Program, Server } from "@phreshos/client"
import Manager from "../source/client/core/manager"

const launches: unknown[] = []
const questions: { event: string; payload: unknown }[] = []
let ready = 0
let raised = 0
let restored = 0

const server = {
    async waitReady() { ready++ },
    async ask(event: string, payload?: unknown) {

        questions.push({ event, payload })

        if (event === "manager.startup") return true
    }
} as unknown as Server

const process = {
    server,
    async exited() { return false },
    client: {
        async exists() { return true },
        window: {
            async minimize(value: boolean) {

                assert.equal(value, false)

                restored++
            },
            async raise() { raised++ }
        }
    }
} as unknown as Process

const program = {
    identity: "lemo",
    process: {
        async findOrCreate(launch: unknown) {

            launches.push(launch)

            return process
        }
    }
} as unknown as Program

const manager = await Manager.open(program)

assert.deepEqual(launches, [{ name: "lemo", server: true, client: false }])
assert.equal(await manager.startup(), true)

await manager.enableStartup(false)
await manager.launch()

assert.deepEqual(questions, [
    { event: "manager.startup", payload: undefined },
    { event: "manager.startup.configure", payload: { enabled: false } }
])
assert.equal(ready, 1)
assert.equal(restored, 1)
assert.equal(raised, 1)
