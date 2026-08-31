import assert from "node:assert/strict"
import { system } from "@phreshos/server"
import endpoints from "../source/server/core/lemo/runtime/tools/endpoints/tool"
import processes from "../source/server/core/lemo/runtime/tools/processes/tool"
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

assert.match(endpoints.docs, /## start/)
assert.match(endpoints.docs, /"service"/)
assert.match(processes.docs, /"service"/)

const starts: unknown[] = []
const process = {
    identity: "1f4b222c-25d7-4ba8-85e5-d5e59cfe0928",
    async program() {
        return { identity: "flambo", server: { start: false, service: true }, client: null }
    },
    server: {
        async exists() { return true },
        async isService() { return true },
        async start(launch: unknown) { starts.push(launch) }
    }
}
const registry = system.process as unknown as { find(identity: string): Promise<unknown> }
const find = registry.find
registry.find = async () => process

try {
    await endpoints.execute(serverStart, {
        memory: { async record() { return {} } }
    } as unknown as ToolContext)
} finally {
    registry.find = find
}

assert.deepEqual(starts, [{ service: true }])

console.log("System Tool contracts verified")
