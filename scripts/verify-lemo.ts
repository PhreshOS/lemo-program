import assert from "node:assert/strict"
import { DatabaseSync } from "node:sqlite"
import type { Subscribable } from "@phreshos/core"
import LemoDatabase, { maximumContextMessages } from "../source/server/core/lemo/database"
import Lemo from "../source/server/core/lemo/lemo"
import Memory from "../source/server/core/lemo/memory"
import type LLMModel from "../source/server/core/llm/model"
import type LLMProvider from "../source/server/core/llm/provider"
import type { ToolContext } from "../source/server/core/lemo/runtime/tool"
import endpoints, { endpointModelOutput } from "../source/server/core/lemo/runtime/tools/endpoints/endpoints"
import files from "../source/server/core/lemo/runtime/tools/files/files"
import memoryTool from "../source/server/core/lemo/runtime/tools/memory/memory"
import processes from "../source/server/core/lemo/runtime/tools/processes/processes"
import programs from "../source/server/core/lemo/runtime/tools/programs/programs"
import promptTool from "../source/server/core/lemo/runtime/tools/prompt/prompt"
import shellTool from "../source/server/core/lemo/runtime/tools/shell/shell"
import tasks from "../source/server/core/lemo/runtime/tools/tasks/tasks"
import timeTool from "../source/server/core/lemo/runtime/tools/time/time"
import toolsTool from "../source/server/core/lemo/runtime/tools/tools/tools"
import windows from "../source/server/core/lemo/runtime/tools/windows/windows"
import toolInput from "../source/server/core/lemo/runtime/tool-input"
import waitEvent from "../source/server/core/lemo/runtime/wait-event"

assert.match(windows.definition.description, /numbers are pixels, never proportions/i)
assert.match(JSON.stringify(windows.definition.parameters), /0\.5 means half a pixel/)
assert.match(windows.docs, /"width": "50%", "height": "100%"/)
assert.match(JSON.stringify(programs.definition.parameters), /"const":"wait"/)
assert.match(JSON.stringify(processes.definition.parameters), /"const":"wait"/)
assert.match(JSON.stringify(endpoints.definition.parameters), /"const":"wait"/)
assert.match(JSON.stringify(windows.definition.parameters), /"const":"wait"/)
assert.match(JSON.stringify(tasks.definition.parameters), /"const":"send"/)

for (const tool of [
    toolsTool,
    memoryTool,
    timeTool,
    tasks,
    programs,
    processes,
    promptTool,
    shellTool,
    endpoints,
    windows,
    files
]) {
    const branches = schemaBranches(tool.definition.parameters)

    assert(branches.length > 0, `${tool.definition.name} must expose an object input schema`)
    assert(branches.every(branch => schemaRecord(schemaRecord(branch.properties)?.approval)?.type === "boolean"),
        `${tool.definition.name} must derive approval from the shared Tool template`)
}

assert.deepEqual(processes.parse({
    action: "create",
    program: "phresh",
    launch: "{\"server\":true,\"client\":true}",
    approval: "true"
}), {
    approval: true,
    input: {
        action: "create",
        program: "phresh",
        launch: { server: true, client: true }
    }
})

assert.deepEqual(endpoints.parse({
    action: "ask",
    process: "browser-server",
    endpoint: "server",
    event: "workspace.create",
    payload: "{\"client\":true}"
}), {
    approval: false,
    input: {
        action: "ask",
        process: "browser-server",
        endpoint: "server",
        event: "workspace.create",
        payload: { client: true }
    }
})

const shellContext = {
    invocation: { signal: new AbortController().signal }
} as unknown as ToolContext
const shellInspection = await shellTool.execute(
    shellTool.parse({ action: "inspect" }).input,
    shellContext
) as Readonly<{ default: string, available: readonly unknown[] }>

assert(shellInspection.default)
assert(shellInspection.available.length > 0)

const inlineShellResult = await shellTool.execute(
    shellTool.parse({ action: "run", command: "printf shell-ready" }).input,
    shellContext
) as Readonly<{ output: Readonly<{ type: string, content: string }> }>

assert.deepEqual(inlineShellResult.output, {
    type: "inline",
    bytes: 11,
    content: "shell-ready"
})

const largeShellResult = await shellTool.execute(
    shellTool.parse({ action: "run", command: "printf '%020000d' 0" }).input,
    shellContext
) as Readonly<{ output: Readonly<{ type: string, id: string, bytes: number }> }>

assert.equal(largeShellResult.output.type, "temporary")
assert.equal(largeShellResult.output.bytes, 20_000)

const retainedShellOutput = await shellTool.execute(shellTool.parse({
    action: "read",
    output: largeShellResult.output.id,
    offset: 19_990,
    limit: 10
}).input, shellContext) as Readonly<{ content: string, next: number | null }>

assert.equal(retainedShellOutput.content, "0000000000")
assert.equal(retainedShellOutput.next, null)

const immediateEvents = {
    async *events() { yield Object.freeze({ value: "received" }) }
} as unknown as Subscribable

assert.deepEqual(
    await waitEvent(immediateEvents, "change", new AbortController().signal, 100),
    { value: "received" }
)

const idleEvents = {
    async *events(_event: string, options: { signal?: AbortSignal } = {}) {

        await new Promise<void>(resolve => {

            if (options.signal?.aborted) resolve()
            else options.signal?.addEventListener("abort", () => resolve(), { once: true })
        })
    }
} as unknown as Subscribable

await assert.rejects(
    waitEvent(idleEvents, "change", new AbortController().signal, 5),
    /timeout 5ms/
)
assert.deepEqual(toolInput({
    action: "setGeometry",
    process: "lemo-process",
    position: "{\"x\":0,\"y\":0}",
    size: "{\"width\":\"50%\",\"height\":\"100%\"}"
}, windows.definition.parameters), {
    action: "setGeometry",
    process: "lemo-process",
    position: { x: 0, y: 0 },
    size: { width: "50%", height: "100%" }
})

assert.deepEqual(toolInput({
    action: "setGeometry",
    position: "{\"x\":\"0/1\",\"y\":\"0/1\"}",
    size: "{\"width\":\"1/2\",\"height\":\"1/1\"}",
    minimized: "false"
}, {
    oneOf: [{
        type: "object",
        properties: {
            action: { const: "setGeometry" },
            position: { type: "object", properties: { x: { type: "string" }, y: { type: "string" } } },
            size: {
                type: "object",
                properties: { width: { type: ["number", "string"] }, height: { type: ["number", "string"] } }
            },
            minimized: { type: "boolean" }
        }
    }]
}), {
    action: "setGeometry",
    position: { x: "0/1", y: "0/1" },
    size: { width: "1/2", height: "1/1" },
    minimized: false
})

assert.equal(toolInput("{\"raw\":true}", {}), "{\"raw\":true}")

const jsonValue = {
    oneOf: [
        { type: "object" },
        { type: "array", items: {} },
        { type: "string" },
        { type: "number" },
        { type: "boolean" },
        { type: "null" }
    ]
}

const endpointInput = {
    type: "object",
    properties: {
        action: { type: "string" },
        payload: jsonValue
    }
}

assert.deepEqual(toolInput({
    action: "ask",
    payload: "{\"client\":true,\"viewport\":{\"width\":1280,\"height\":720}}"
}, endpointInput), {
    action: "ask",
    payload: { client: true, viewport: { width: 1280, height: 720 } }
})

assert.deepEqual(toolInput({ action: "ask", payload: "{}" }, endpointInput), {
    action: "ask",
    payload: {}
})

assert.deepEqual(toolInput({ action: "ask", payload: "null" }, endpointInput), {
    action: "ask",
    payload: null
})

assert.deepEqual(endpointModelOutput({
    id: "snapshot",
    image: "A".repeat(10_000),
    title: "PhreshOS"
}), {
    id: "snapshot",
    image: {
        kind: "binary",
        characters: 10_000,
        note: "Binary content is retained in the database but omitted from text Model context."
    },
    title: "PhreshOS"
})

const database = new DatabaseSync(":memory:")

const client = {
    publish() {},
    subscribe() { return () => {} }
}

const lemo = await Lemo.wakeUp(database, client)

assert(lemo instanceof Lemo)

await Lemo.wakeUp(database, client)

const tables = database.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
`).all().map(row => row.name)

assert.deepEqual(tables, [
    "messages",
    "operation_relationships",
    "operations",
    "tasks"
])

const foreignKeys = database.prepare("PRAGMA foreign_keys").get()

assert.equal(foreignKeys?.foreign_keys, 1)

const first = deferred()
const second = deferred()
const cycles = new Map<string, number>()
const snapshots = new Map<string, string[]>()

let model!: LLMModel

const provider: LLMProvider = {
    identity: "test",
    name: "Test",
    active: true,
    async models() {

        return [model]
    }
}

model = {
    id: "test-model",
    provider,
    async *generate(request) {

        const input = request.messages.findLast(message => message.role === "user")?.content

        assert(input)

        const snapshot = request.messages.find(message => (
            message.role === "system" && message.content.startsWith("# Reconstructed Mind Context")
        ))

        assert(snapshot)
        assert(snapshot.content.includes('<self task='))
        assert.match(snapshot.content, /<execution run="[^"]+" reason="(?:created|continued)" startedAt="[^"]+" cycle="[^"]+" cycleStartedAt="[^"]+">/)
        assert(snapshot.content.includes('<llm_model role="active" provider="test" id="test-model" />'))
        assert(snapshot.content.includes('<llm_model role="initial" provider="test" id="test-model" />'))
        assert(snapshot.content.includes('<immediate_continuity precedence="before-associative-memory">'))
        assert(snapshot.content.includes('<active_tasks omitted='))
        assert(snapshot.content.includes('<shared_memory role="possible-associations"'))
        assert(snapshot.content.includes("</shared_memory>"))

        snapshots.set(input, [...snapshots.get(input) ?? [], snapshot.content])

        const cycle = (cycles.get(input) ?? 0) + 1

        cycles.set(input, cycle)

        if (input === "recall first") {

            assert.deepEqual(request.tools.map(tool => tool.name), ["tools", "docs", "memory"])

            if (cycle === 1) {

                yield {
                    type: "tool-call" as const,
                    call: { id: "recall-memory", name: "memory", input: { query: "first", budget: 1_000 } }
                }

                return
            }

            const memoryResult = request.messages.find(message => message.role === "tool" && message.name === "memory")

            assert(memoryResult)

            const result = JSON.parse(memoryResult.content) as Record<string, unknown>

            assert(Array.isArray(result.output))

            assert(result.output.some(item => (
                typeof item === "object"
                && item !== null
                && "content" in item
                && String(item.content).includes("first")
            )))

            yield { type: "text" as const, content: "memory:complete" }

            return
        }

        if (input === "produce unique task failure") {

            throw new Error("unique task failure evidence")
        }

        if (input === "inspect unique task failure evidence") {

            assert(snapshot.content.includes('kind="task.failed"'))
            assert(snapshot.content.includes('method="task-failure"'))
            assert(snapshot.content.includes("Task failed: unique task failure evidence"))

            yield { type: "text" as const, content: "task-failure:recalled" }

            return
        }

        if (input === "produce missing capability failure") {

            if (cycle === 1) {

                yield {
                    type: "tool-call" as const,
                    call: { id: "missing-capability-call", name: "missing-capability", input: {} }
                }

                return
            }

            yield { type: "text" as const, content: "tool-failure:produced" }

            return
        }

        if (input === "inspect missing capability failure") {

            assert(snapshot.content.includes('kind="tool.result"'))
            assert(snapshot.content.includes('method="tool-result"'))
            assert(snapshot.content.includes('tool="missing-capability"'))
            assert(snapshot.content.includes('call="missing-capability-call"'))

            yield { type: "text" as const, content: "tool-failure:recalled" }

            return
        }

        if (input === "delegated child") {

            assert.match(snapshot.content, /<origin type="task" task="[^"]+" call="create-child" \/>/)
            assert.match(snapshot.content, /<objective source="task:[^"]+" method="task-input"/)

            yield { type: "text" as const, content: "delegated child:complete" }

            return
        }

        if (input === "delegate work") {

            if (cycle === 1) {

                yield {
                    type: "tool-call" as const,
                    call: { id: "load-tasks", name: "tools", input: { names: ["tasks"] } }
                }

                return
            }

            if (cycle === 2) {

                yield {
                    type: "tool-call" as const,
                    call: { id: "create-child", name: "tasks", input: {
                        action: "create",
                        input: "delegated child"
                    } }
                }

                return
            }

            const results = request.messages.filter(message => (
                message.role === "tool" && message.name === "tasks"
            ))
            const result = results[0]

            assert(result)
            const created = JSON.parse(result.content).output

            assert.equal(created.source, "task")

            if (cycle === 3) {

                yield {
                    type: "tool-call" as const,
                    call: { id: "wait-child", name: "tasks", input: {
                        action: "wait",
                        tasks: [created.id],
                        events: ["completed"]
                    } }
                }

                return
            }

            assert.equal(JSON.parse(results.at(-1)!.content).output.event, "completed")

            yield { type: "text" as const, content: "delegate work:complete" }

            return
        }

        if (cycle === 1) {

            assert.deepEqual(request.tools.map(tool => tool.name), ["tools", "docs", "memory"])

            await (input === "first" ? first.promise : second.promise)

            yield {
                type: "tool-call" as const,
                call: {
                    id: `${input}-tools`,
                    name: "tools",
                    input: {
                        names: ["time", "tasks", "programs", "processes", "endpoints", "windows"]
                    }
                }
            }

            return
        }

        if (cycle === 2) {

            assert.deepEqual(request.tools.map(tool => tool.name), [
                "tools",
                "docs",
                "memory",
                "time",
                "tasks",
                "programs",
                "processes",
                "endpoints",
                "windows"
            ])

            assert(request.messages.some(message => message.role === "tool" && message.name === "tools"))

            yield {
                type: "tool-call" as const,
                call: { id: `${input}-time-a`, name: "time", input: {} }
            }

            yield {
                type: "tool-call" as const,
                call: { id: `${input}-time-b`, name: "time", input: {} }
            }

            return
        }

        assert.equal(request.messages.filter(message => message.role === "tool" && message.name === "time").length, 2)

        yield { type: "text" as const, content: `${input}:complete` }
    }
}

const firstTask = await lemo.task({ input: "first", model })

const secondTask = await lemo.task({ input: "second", model })

assert.equal(await firstTask.status(), "running")

assert.equal(await secondTask.status(), "running")

first.resolve()

second.resolve()

assert.deepEqual(await Promise.all([firstTask.result(), secondTask.result()]), [
    "first:complete",
    "second:complete"
])

assert.equal(await firstTask.status(), "completed")

assert.equal(await secondTask.status(), "completed")

const operations = database.prepare(`
    SELECT sequence, id, task_id, parent_id, kind, payload
    FROM operations
    ORDER BY sequence
`).all()

assert.equal(operations.length, 40)

for (const task of [firstTask, secondTask]) {

    const related = operations.filter(operation => operation.task_id === task.id)

    assert.deepEqual(related.map(operation => operation.kind), [
        "task.input",
        "task.run.started",
        "cycle.started",
        "model.event",
        "model.message",
        "cycle.completed",
        "tool.tools.loaded",
        "tool.result",
        "cycle.started",
        "model.event",
        "model.event",
        "model.message",
        "cycle.completed",
        "tool.result",
        "tool.result",
        "cycle.started",
        "model.event",
        "model.message",
        "cycle.completed",
        "task.completed"
    ])

    assert.equal(related[0]?.parent_id, null)

    for (let index = 1; index < related.length; index++) {

        assert.equal(related[index]?.parent_id, related[index - 1]?.id)
    }
}

for (const [input, task] of [["first", firstTask], ["second", secondTask]] as const) {

    const recalled = snapshots.get(input)

    assert(recalled?.length)
    assert(recalled.every(snapshot => !snapshot.includes(`<episode task="${task.id}">`)))
    assert(recalled.some(snapshot => snapshot.includes('source="tool:tools"')))
}

const recordedInput = operations.find(operation => operation.task_id === firstTask.id)

assert.deepEqual(JSON.parse(String(recordedInput?.payload)), {
    model: { provider: "test", id: "test-model" },
    source: { type: "user" },
    input: "first"
})

assert(!operations.some(operation => operation.kind === "model.request"))
assert(!operations.some(operation => String(operation.payload).includes("# Reconstructed Mind Context")))

const memoryTask = await lemo.task({ input: "recall first", model })

assert.equal(await memoryTask.result(), "memory:complete")

const memoryOperations = await memoryTask.operations()

assert(memoryOperations.some(operation => operation.kind === "tool.memory.recalled"))

const memoryResult = memoryOperations.find(operation => operation.kind === "tool.result")

assert(memoryResult)

const memoryPayload = memoryResult.payload as Record<string, unknown>

assert(Array.isArray(memoryPayload.output))

assert(memoryPayload.output.every(item => (
    typeof item === "object"
    && item !== null
    && "kind" in item
    && "selection" in item
    && ["recent", "relevant", "context"].includes(String(item.selection))
)))

assert(memoryPayload.output.reduce((size, item) => (
    typeof item === "object" && item !== null && "content" in item
        ? size + String(item.content).length + 180
        : size
), 0) <= 1_000)

const delegated = await lemo.task({ input: "delegate work", model })

assert.equal(await delegated.result(), "delegate work:complete")

const failedTask = await lemo.task({ input: "produce unique task failure", model })

await assert.rejects(failedTask.result(), /unique task failure evidence/)

const failureContext = await lemo.task({ input: "inspect unique task failure evidence", model })

assert.equal(await failureContext.result(), "task-failure:recalled")

const toolFailure = await lemo.task({ input: "produce missing capability failure", model })

assert.equal(await toolFailure.result(), "tool-failure:produced")

const toolFailureContext = await lemo.task({ input: "inspect missing capability failure", model })

assert.equal(await toolFailureContext.result(), "tool-failure:recalled")

const restarted = await Lemo.wakeUp(database, client)

const restored = await restarted.findTask(firstTask.id)

assert(restored)

assert.notEqual(restored, firstTask)

assert.equal(await restored.status(), "completed")

assert.equal(await restored.result(), "first:complete")

assert.deepEqual(
    (await restored.operations()).map(operation => operation.id),
    (await firstTask.operations()).map(operation => operation.id)
)

assert.equal(await restarted.findTask("unknown"), null)

const compactSource = new DatabaseSync(":memory:")
const compactDatabase = await LemoDatabase.open(compactSource)

for (let index = 0; index < 20; index++) {

    await compactDatabase.createTask(`compact-${index}`, { input: `compact fact ${index}` })
}

const compact = await new Memory(compactDatabase).recall({ query: "compact", budget: 1_000 })

const largeSource = new DatabaseSync(":memory:")
const largeDatabase = await LemoDatabase.open(largeSource)

for (let index = 0; index < 5; index++) {

    await largeDatabase.createTask(`large-${index}`, {
        input: `large fact ${index} ${"content ".repeat(100)}`
    })
}

const large = await new Memory(largeDatabase).recall({ query: "large", budget: 1_000 })

assert(compact.length > large.length)

const continuitySource = new DatabaseSync(":memory:")
const continuityDatabase = await LemoDatabase.open(continuitySource)

await continuityDatabase.createTask("identity", { input: "My name is Zohayr" })
await continuityDatabase.appendToTask("identity", "model.message", {
    content: "Your name is Zohayr"
})

await continuityDatabase.createTask("long-operation", { input: "Open a browser" })

for (let index = 0; index < 12; index++) {

    await continuityDatabase.appendToTask("long-operation", "model.message", {
        content: `Browser operation ${index} ${"working ".repeat(30)}`
    })
}

const continuity = await new Memory(continuityDatabase).recall({
    query: "an unrelated follow-up",
    budget: 2_000
})

assert(continuity.some(result => result.task === "long-operation"))
assert(continuity.some(result => result.task === "identity"))

const fittingSource = new DatabaseSync(":memory:")
const fittingDatabase = await LemoDatabase.open(fittingSource)

await fittingDatabase.createTask("small", { input: "needle remains accessible" })
await fittingDatabase.createTask("oversized", { input: "large ".repeat(300) })

const fitting = await new Memory(fittingDatabase).recall({ query: "needle", budget: 1_000 })

assert(fitting.some(result => result.task === "small"))
assert(fitting.reduce((size, result) => size + result.content.length + 180, 0) <= 1_000)

const activationSource = new DatabaseSync(":memory:")
const activationDatabase = await LemoDatabase.open(activationSource)

await activationDatabase.createTask("recovery", {
    input: "Recover the browser after a websocket transport timeout"
})
await activationDatabase.createTask("recent-unrelated", {
    input: "Change the wallpaper color"
})

const activated = await new Memory(activationDatabase).recall({
    query: "Investigate the current failure",
    focus: [{
        source: "tool-result:endpoints",
        content: "The websocket transport timed out while opening the browser",
        weight: 2.4
    }],
    budget: 1_000
})

assert(activated.some(result => result.task === "recovery" && result.selection === "relevant"))

const toolResultSource = new DatabaseSync(":memory:")
const toolResultDatabase = await LemoDatabase.open(toolResultSource)
const workspaceIdentity = "bd4e05ac-b3bd-4f53-83b0-d641f717ed19"

await toolResultDatabase.createTask("workspace-history", { input: "Inspect old browser workspaces" })
await toolResultDatabase.appendToTask("workspace-history", "tool.result", {
    call: "workspace-list",
    name: "endpoints",
    ok: true,
    output: { workspaces: [{ workspace: workspaceIdentity }], transport: "raw-preserved" },
    modelOutput: { workspaces: [{ workspace: workspaceIdentity }] }
})

const toolResultContext = await new Memory(toolResultDatabase).recall({
    query: "Find the old browser workspace",
    budget: 1_000
})

assert(toolResultContext.some(result => (
    result.method === "tool-result"
    && result.tool === "endpoints"
    && result.content.includes(workspaceIdentity)
)))

const storedToolResult = (await toolResultDatabase.operations("workspace-history", {
    limit: 10,
    order: "oldest"
})).operations.find(operation => operation.kind === "tool.result")

assert.deepEqual((storedToolResult?.payload as Record<string, unknown>).output, {
    workspaces: [{ workspace: workspaceIdentity }],
    transport: "raw-preserved"
})

const mindSource = new DatabaseSync(":memory:")
const mindDatabase = await LemoDatabase.open(mindSource)

await mindDatabase.createTask("self", {
    input: "Recover the browser workspace",
    source: { type: "user" },
    model: { provider: "test", id: "test-model" }
})
await mindDatabase.appendToTask("self", "task.run.started", {
    run: "self-run",
    reason: "created",
    model: { provider: "test", id: "test-model" }
})
await mindDatabase.appendToTask("self", "cycle.started", {
    run: "self-run",
    model: { provider: "test", id: "test-model" }
})
await mindDatabase.createTask("running-related", { input: "Monitor browser workspace changes" })
await mindDatabase.appendToTask("running-related", "task.run.started", { run: "related-run" })
await mindDatabase.appendToTask("running-related", "model.message", {
    content: "Waiting for the browser workspace event"
})
await mindDatabase.createTask("running-unrelated", { input: "Compose a short song" })
await mindDatabase.appendToTask("running-unrelated", "task.run.started", { run: "unrelated-run" })
await mindDatabase.appendToTask("running-unrelated", "model.message", {
    content: "Choosing the song melody"
})
await mindDatabase.createTask("completed-related", { input: "Browser workspace recovery" })
await mindDatabase.appendToTask("completed-related", "model.message", {
    content: "The browser workspace was restored from its durable identity"
})
await mindDatabase.appendToTask("completed-related", "task.completed", { output: "restored" })
await mindDatabase.createTask("completed-noise", { input: "hhhhhh" })
await mindDatabase.appendToTask("completed-noise", "model.message", { content: "A generic greeting" })
await mindDatabase.appendToTask("completed-noise", "task.completed", { output: "done" })

const mindSnapshot = await new Memory(mindDatabase).context(
    (await mindDatabase.operations("self", { limit: 10, order: "oldest" })).operations
)

assert(mindSnapshot.includes('<self task="self" perspective="self" relation="self" status="running"'))
assert(mindSnapshot.includes('<origin type="user" task="" call="" />'))
assert(mindSnapshot.includes('<execution run="self-run" reason="created"'))
assert(mindSnapshot.includes('<llm_model role="active" provider="test" id="test-model" />'))
assert(mindSnapshot.includes('<task task="running-related" perspective="other" relation="concurrent" status="running"'))
assert(mindSnapshot.includes('<task task="running-unrelated" perspective="other" relation="concurrent" status="running"'))
assert(mindSnapshot.includes('<episode task="completed-related" perspective="other" relation="associative" status="completed"'))
assert(mindSnapshot.includes('source="lemo" method="model-message"'))
assert.match(mindSnapshot, /generatedAt="\d{4}-\d{2}-\d{2}T/)
assert(mindSnapshot.includes('reason="possible-semantic-association"'))
assert(!mindSnapshot.includes("completed-noise"))
assert(!mindSnapshot.includes('<episode task="self"'))

const messageSource = new DatabaseSync(":memory:")
const messageDatabase = await LemoDatabase.open(messageSource)

await messageDatabase.createTask("sender", { input: "Coordinate the work" })
await messageDatabase.appendToTask("sender", "task.run.started", { run: "sender-run" })
await messageDatabase.createTask("receiver", { input: "Perform the coordinated work" })
await messageDatabase.appendToTask("receiver", "task.run.started", { run: "receiver-run" })

for (let index = 0; index < 12; index++) {

    await messageDatabase.sendMessage({
        sourceTask: "sender",
        sourceCall: `message-call-${index}`,
        targetTask: "receiver",
        content: `[directed-message:${String(index).padStart(2, "0")}]`
    })
}

const receiverOperations = (await messageDatabase.operations("receiver", {
    limit: 10,
    order: "oldest"
})).operations
const firstMessageContext = await new Memory(messageDatabase).context(receiverOperations)

assert(firstMessageContext.includes("## Messages"))
assert.equal((firstMessageContext.match(/  <message /g) ?? []).length, maximumContextMessages)
assert(!firstMessageContext.includes("[directed-message:00]"))
assert(!firstMessageContext.includes("[directed-message:01]"))

for (let index = 2; index < 12; index++) {

    assert(firstMessageContext.includes(`[directed-message:${String(index).padStart(2, "0")}]`))
}

assert.equal((firstMessageContext.match(/delivery="new"/g) ?? []).length, maximumContextMessages)

const storedMessages = messageSource.prepare(`
    SELECT sequence, delivered_at
    FROM messages
    ORDER BY sequence
    LIMIT 20
`).all()

assert.equal(storedMessages.length, 12)
assert.equal(storedMessages.filter(message => message.delivered_at === null).length, 2)

const delivered = new Map(storedMessages.map(message => [message.sequence, message.delivered_at]))
const repeatedMessageContext = await new Memory(messageDatabase).context(receiverOperations)

assert.equal((repeatedMessageContext.match(/delivery="new"/g) ?? []).length, 0)
assert.equal(
    (repeatedMessageContext.match(/delivery="previously-delivered"/g) ?? []).length,
    maximumContextMessages
)

for (const message of messageSource.prepare(`
    SELECT sequence, delivered_at
    FROM messages
    WHERE delivered_at IS NOT NULL
    ORDER BY sequence
    LIMIT 20
`).all()) {

    assert.equal(message.delivered_at, delivered.get(message.sequence))
}

await messageDatabase.appendToTask("receiver", "task.completed", { output: "done" })

await assert.rejects(messageDatabase.sendMessage({
    sourceTask: "sender",
    sourceCall: "too-late",
    targetTask: "receiver",
    content: "This should not be accepted"
}), /completed Task cannot receive messages/)

await assert.rejects(messageDatabase.sendMessage({
    sourceTask: "sender",
    sourceCall: "self-message",
    targetTask: "sender",
    content: "This should not be accepted"
}), /cannot send a message to itself/)

const perceptualSource = new DatabaseSync(":memory:")
const continuityMindDatabase = await LemoDatabase.open(perceptualSource)

for (const [task, input, output] of [
    ["older-association", "Try again to open YouTube", "youtube opened"],
    ["recent-background-a", "Inspect the current wallpaper", "wallpaper inspected"],
    ["recent-background-b", "Check the current clock", "clock checked"],
    ["immediate", "Wait for the Lemo window to minimize", "window wait completed"]
] as const) {

    await continuityMindDatabase.createTask(task, { input })
    await continuityMindDatabase.appendToTask(task, "model.message", { content: output })
    await continuityMindDatabase.appendToTask(task, "task.completed", { output })
}

await continuityMindDatabase.createTask("follow-up", { input: "Yes, try again" })
await continuityMindDatabase.appendToTask("follow-up", "task.run.started", { run: "follow-up-run" })

const continuitySnapshot = await new Memory(continuityMindDatabase).context(
    (await continuityMindDatabase.operations("follow-up", { limit: 10, order: "oldest" })).operations
)

assert(continuitySnapshot.includes(
    '<task task="immediate" perspective="other" relation="immediately-before" status="completed"'
))
assert(continuitySnapshot.includes('reason="temporal-continuity"'))
assert(continuitySnapshot.includes(
    '<episode task="older-association" perspective="other" relation="associative" status="completed"'
))
assert(continuitySnapshot.includes('reason="semantic-association"'))
assert(continuitySnapshot.indexOf('task="immediate"') < continuitySnapshot.indexOf('task="older-association"'))

const transcriptSource = new DatabaseSync(":memory:")
const transcriptDatabase = await LemoDatabase.open(transcriptSource)

await transcriptDatabase.createTask("transcript", { input: "Keep meaningful turns" })
await transcriptDatabase.appendToTask("transcript", "model.message", { content: "Earlier answer" })

for (let index = 0; index < 600; index++) {
    await transcriptDatabase.appendToTask("transcript", "model.event", {
        type: "text",
        content: `raw-${index}`
    })
}

await transcriptDatabase.appendToTask("transcript", "tool.result", {
    call: "call",
    name: "time",
    ok: false,
    error: "Recorded mistake"
})

const transcript = await transcriptDatabase.transcriptOperations("transcript", 512)

assert.deepEqual(transcript.map(operation => operation.kind), ["model.message", "tool.result"])
assert.equal(transcript.some(operation => operation.kind === "model.event"), false)

database.close()
compactSource.close()
largeSource.close()
perceptualSource.close()
fittingSource.close()
activationSource.close()
toolResultSource.close()
mindSource.close()
messageSource.close()
continuitySource.close()
transcriptSource.close()

function deferred() {

    let resolve!: () => void

    const promise = new Promise<void>(done => {

        resolve = done
    })

    return { promise, resolve }
}

function schemaBranches(schema: Readonly<Record<string, unknown>>) {

    const branches = Array.isArray(schema.oneOf)
        ? schema.oneOf
        : Array.isArray(schema.anyOf)
            ? schema.anyOf
            : null

    return branches
        ? branches.map(schemaRecord).filter((branch): branch is Readonly<Record<string, unknown>> => branch !== null)
        : [schema]
}

function schemaRecord(value: unknown) {

    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? value as Readonly<Record<string, unknown>>
        : null
}
