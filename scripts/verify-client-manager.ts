import assert from "node:assert/strict"
import type { Process, Program, Server } from "@phreshos/client"
import Manager from "../source/client/core/manager"

const launches: unknown[] = []
const questions: { event: string; payload: unknown }[] = []
let ready = 0
let raised = 0
let restored = 0
let managerExits = 0
const startupEvents = channel()
const processSubscribers = new Map<string, Set<(value: unknown) => void>>()

const server = {
    events() {

        return startupEvents
    },
    async waitReady() { ready++ },
    async ask(event: string, payload?: unknown) {

        questions.push({ event, payload })

        if (event === "manager.startup") return true

        if (event === "manager.startup.configure") {
            startupEvents.push({
                type: "manager.startup.changed",
                enabled: (payload as { enabled: boolean }).enabled
            })
        }
    }
} as unknown as Server

const process = {
    server,
    async exited() { return false },
    subscribe(event: string, subscriber: (value: unknown) => void) {

        const subscribers = processSubscribers.get(event) ?? new Set()

        subscribers.add(subscriber)
        processSubscribers.set(event, subscribers)

        return () => subscribers.delete(subscriber)
    },
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

const managerProcess = {
    async exit() { managerExits++ }
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

const manager = await Manager.open(program, managerProcess)

assert.deepEqual(launches, [{ name: "lemo", server: true, client: false }])
assert.equal(await manager.startup(), true)

await manager.enableStartup(false)
await settled()

assert.equal(await manager.startup(), false)
assert.equal(manager.startupVersion(), 1)

await manager.launch()

assert.deepEqual(questions, [
    { event: "manager.startup", payload: undefined },
    { event: "manager.startup.configure", payload: { enabled: false } }
])
assert.equal(ready, 1)
assert.equal(restored, 1)
assert.equal(raised, 1)

publishProcess("endpointStop", process.server)
publishProcess("exit", { status: "exited", code: 0, signal: null })
await settled()

assert.equal(managerExits, 1)

manager.stop()

function publishProcess(event: string, value: unknown) {

    for (const subscriber of processSubscribers.get(event) ?? []) subscriber(value)
}

function channel() {

    const values: unknown[] = []
    const waiting: ((result: IteratorResult<unknown>) => void)[] = []

    return {
        push(value: unknown) {

            const resolve = waiting.shift()

            if (resolve) resolve({ value, done: false })
            else values.push(value)
        },
        [Symbol.asyncIterator]() {

            return {
                next(): Promise<IteratorResult<unknown>> {

                    const value = values.shift()

                    return value === undefined
                        ? new Promise(resolve => waiting.push(resolve))
                        : Promise.resolve({ value, done: false })
                }
            }
        }
    }
}

async function settled() {

    await Promise.resolve()
    await Promise.resolve()
}
