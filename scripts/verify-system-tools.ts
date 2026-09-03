import assert from "node:assert/strict"
import { system } from "@phreshos/server"
import endpoints from "../source/server/core/lemo/runtime/tools/endpoints/tool"
import processes from "../source/server/core/lemo/runtime/tools/processes/tool"
import programs from "../source/server/core/lemo/runtime/tools/programs/tool"
import type { ToolContext } from "../source/server/core/lemo/runtime/tool"

const serverStart = endpoints.parse({
    action: "start",
    process: "1f4b222c-25d7-4ba8-85e5-d5e59cfe0928",
    endpoint: "server",
    launch: { service: true }
}).input

assert.deepEqual(serverStart, {
    action: "start",
    process: "1f4b222c-25d7-4ba8-85e5-d5e59cfe0928",
    endpoint: "server",
    launch: { service: true }
})

assert.throws(() => endpoints.parse({
    action: "start",
    process: "1f4b222c-25d7-4ba8-85e5-d5e59cfe0928",
    endpoint: "server",
    launch: { title: "Not a Server setting" }
}))

assert.deepEqual(processes.parse({
    action: "create",
    program: "flambo",
    launch: {
        name: "browser-server",
        server: { service: true },
        client: false
    }
}).input, {
    action: "create",
    program: "flambo",
    launch: {
        name: "browser-server",
        server: { service: true },
        client: false
    }
})

assert.match(endpoints.docs, /Use `start`/)
assert.match(processes.docs, /`findOrCreate`/)
assert.match(JSON.stringify(endpoints.definition.parameters), /"service"/)
assert.match(JSON.stringify(processes.definition.parameters), /"service"/)

assert.throws(() => endpoints.parse({
    action: "waitReady",
    process: "1f4b222c-25d7-4ba8-85e5-d5e59cfe0928",
    endpoint: "client"
}))

assert.throws(() => processes.parse({
    action: "wait",
    event: "create",
    process: "1f4b222c-25d7-4ba8-85e5-d5e59cfe0928"
}))

assert.throws(() => programs.parse({
    action: "wait",
    event: "install",
    program: "flambo"
}))

const starts: unknown[] = []
let stops = 0
const process = {
    identity: "1f4b222c-25d7-4ba8-85e5-d5e59cfe0928",
    async program() {
        return { identity: "flambo", server: { start: false, service: true }, client: null }
    },
    server: {
        async exists() { return true },
        async isService() { return true },
        async start(launch: unknown) { starts.push(launch) },
        async stop() { stops++ },
        lifecycle: {
            events() {
                return {
                    async next() { return { done: false, value: undefined } },
                    async return() { return { done: true, value: undefined } },
                    [Symbol.asyncIterator]() { return this }
                }
            }
        }
    }
}
const registry = system.process as unknown as { find(identity: string): Promise<unknown> }
const find = registry.find
registry.find = async () => process

try {
    await endpoints.execute(serverStart, {
        memory: { async record() { return {} } }
    } as unknown as ToolContext)

    const waitLifecycle = endpoints.parse({
        action: "waitLifecycle",
        process: "1f4b222c-25d7-4ba8-85e5-d5e59cfe0928",
        endpoint: "server",
        event: "stop"
    }).input

    await endpoints.execute(waitLifecycle, {
        invocation: { signal: new AbortController().signal }
    } as unknown as ToolContext)
} finally {
    registry.find = find
}

assert.deepEqual(starts, [{ service: true }])
assert.equal(stops, 0)

console.log("System Tool contracts verified")
