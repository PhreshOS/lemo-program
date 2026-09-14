import assert from "node:assert/strict"
import { DatabaseSync } from "node:sqlite"
import type { Subscribable } from "@phreshos/core"
import LemoDatabase, {
    maximumContextMessages
} from "../source/server/core/lemo/database"
import { cycleContextBudgets } from "../source/server/core/lemo/context"
import Lemo from "../source/server/core/lemo/lemo"
import Memory from "../source/server/core/lemo/memory"
import { estimatedTokens } from "../source/server/core/lemo/token-budget"
import type LLMModel from "../source/server/core/llm/model"
import type LLMProvider from "../source/server/core/llm/provider"
import type { ToolContext } from "../source/server/core/lemo/runtime/tool"
import endpoints, { endpointModelOutput } from "../source/server/core/lemo/runtime/tools/endpoints/tool"
import files from "../source/server/core/lemo/runtime/tools/files/tool"
import memoryTool from "../source/server/core/lemo/runtime/tools/memory/tool"
import processes from "../source/server/core/lemo/runtime/tools/processes/tool"
import programs from "../source/server/core/lemo/runtime/tools/programs/tool"
import promptTool from "../source/server/core/lemo/runtime/tools/prompt/tool"
import shellTool from "../source/server/core/lemo/runtime/tools/shell/tool"
import tasks from "../source/server/core/lemo/runtime/tools/tasks/tool"
import timeTool from "../source/server/core/lemo/runtime/tools/time/tool"
import toolsTool from "../source/server/core/lemo/runtime/tools/tools/tool"
import windows from "../source/server/core/lemo/runtime/tools/windows/tool"
import web from "../source/server/core/lemo/runtime/tools/web/tool"
import toolInput from "../source/server/core/lemo/runtime/tool-input"
import waitEvent from "../source/server/core/lemo/runtime/wait-event"
import { test } from "vitest"

test("lemo contract", async () => {
  assert.deepEqual(await cycleContextBudgets({
      async contextWindow() { return null }
  }), { perceptualField: 8_000, transcript: 12_000 })

  const expandedContextBudgets = await cycleContextBudgets({
      async contextWindow() { return 124_000 }
  })

  assert.deepEqual(expandedContextBudgets, { perceptualField: 8_000, transcript: 12_000 })
  assert(Object.isFrozen(expandedContextBudgets))

  await assert.rejects(
      cycleContextBudgets({ async contextWindow() { return 1 } }),
      /invalid context window/
  )

  assert.match(windows.docs, /Geometry numbers are absolute pixels/i)
  assert.match(JSON.stringify(windows.definition.parameters), /Absolute pixels as a number/i)
  assert.match(windows.docs, /"size":\{"width":"50%","height":"100%"\}/)
  assert.match(JSON.stringify(programs.definition.parameters), /"const":"wait"/)
  assert.match(JSON.stringify(processes.definition.parameters), /"const":"wait"/)
  assert.match(JSON.stringify(endpoints.definition.parameters), /"const":"wait"/)
  assert.match(JSON.stringify(windows.definition.parameters), /"const":"wait"/)
  assert.match(JSON.stringify(tasks.definition.parameters), /"const":"send"/)
  assert.match(JSON.stringify(tasks.definition.parameters), /"const":"read_block"/)
  assert.match(JSON.stringify(tasks.definition.parameters), /"const":"wait_message"/)

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
      web,
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
  ) as Readonly<{ output: Readonly<{ type: string, bytes: number, content: string }> }>

  assert.equal(largeShellResult.output.type, "stored")
  assert.equal(largeShellResult.output.bytes, 20_000)
  assert.equal(largeShellResult.output.content.length, 20_000)
  assert.equal(
      (shellTool.modelOutput?.(largeShellResult) as { output: { content?: string } }).output.content,
      undefined
  )

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

  const lemo = await Lemo.wakeUp(database)

  assert(lemo instanceof Lemo)

  await Lemo.wakeUp(database)

  const tables = database.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name
  `).all().map(row => row.name)

  assert.deepEqual(tables, [
      "memory_activations",
      "memory_retrievals",
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
  const observationPath = `${process.cwd()}/package.json`
  const measuredUsage = Object.freeze({
      input: Object.freeze({ tokens: 1_200, cachedTokens: 800 }),
      output: Object.freeze({ tokens: 120, reasoningTokens: 40 })
  })

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
      reasoning: null,
      async contextWindow() { return null },
      async reasoningLevels() { return null },
      async setReasoning() {},
      async *generate(request) {

          const input = request.messages.findLast(message => message.role === "user")?.content

          assert(input)

          const snapshot = request.messages.find(message => (
              message.role === "user" && message.content.startsWith("<perceptual_field")
          ))

          assert(snapshot)
          assert(estimatedTokens(snapshot.content) <= 50_000)
          assert(snapshot.content.includes('<environment runtime="PhreshOS" authority="server" />'))
          assert(snapshot.content.includes('<task id='))
          assert.match(snapshot.content, /<execution run="[^"]+" reason="(?:created|continued)" startedAt="[^"]+" cycle="[^"]+" cycleStartedAt="[^"]+" \/>/)
          assert(snapshot.content.includes('<llm_model role="active" provider="test" id="test-model" />'))
          assert(snapshot.content.includes('<llm_model role="initial" provider="test" id="test-model" />'))
          assert(snapshot.content.includes('<semantic_memory budget='))
          assert(snapshot.content.includes('<inbox budget='))
          assert(!snapshot.content.includes('<system>'))
          assert(!snapshot.content.includes('<current_task'))
          assert(!snapshot.content.includes('<nearby_tasks'))

          snapshots.set(input, [...snapshots.get(input) ?? [], snapshot.content])

          const cycle = (cycles.get(input) ?? 0) + 1

          cycles.set(input, cycle)

          if (input === "repeat observation") {
              if (cycle === 1) {
                  yield {
                      type: "tool-call" as const,
                      call: { id: "load-files", name: "tools", input: { names: ["files"] } }
                  }

                  return measuredUsage
              }

              if (cycle === 2 || cycle === 3) {
                  yield {
                      type: "tool-call" as const,
                      call: {
                          id: `read-files-${cycle}`,
                          name: "files",
                          input: { action: "read", path: observationPath, lineCount: 20 }
                      }
                  }

                  return measuredUsage
              }

              const result = request.messages.filter(message => (
                  message.role === "tool" && message.name === "files"
              )).at(-1)

              assert(result)
              assert.equal(JSON.parse(result.content).output.status, "no-progress")

              yield { type: "text" as const, content: "observation-loop:stopped" }

              return measuredUsage
          }

          if (input === "recall first") {

              assert.deepEqual(request.tools.map(tool => tool.name), ["tools", "docs", "memory"])

              if (cycle === 1) {

                  yield {
                      type: "tool-call" as const,
                      call: { id: "recall-memory", name: "memory", input: { query: "first", budget: 1_000 } }
                  }

                  return measuredUsage
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

              return measuredUsage
          }

          if (input === "produce unique task failure") {

              throw new Error("unique task failure evidence")
          }

          if (input === "inspect unique task failure evidence") {

              assert(!snapshot.content.includes("Task failed: unique task failure evidence"))

              yield { type: "text" as const, content: "task-failure:recalled" }

              return measuredUsage
          }

          if (input === "produce missing capability failure") {

              if (cycle === 1) {

                  yield {
                      type: "tool-call" as const,
                      call: { id: "missing-capability-call", name: "missing-capability", input: {} }
                  }

                  return measuredUsage
              }

              yield { type: "text" as const, content: "tool-failure:produced" }

              return measuredUsage
          }

          if (input === "inspect missing capability failure") {

              assert(!snapshot.content.includes('tool="missing-capability"'))
              assert(!snapshot.content.includes('call="missing-capability-call"'))

              yield { type: "text" as const, content: "tool-failure:recalled" }

              return measuredUsage
          }

          if (input === "delegated child") {

              assert.match(snapshot.content, /<origin type="task" task="[^"]+" call="create-child" \/>/)
              assert(request.messages.some(message => message.role === "user" && message.content === "delegated child"))

              yield { type: "text" as const, content: "delegated child:complete" }

              return measuredUsage
          }

          if (input === "delegate work") {

              if (cycle === 1) {

                  yield {
                      type: "tool-call" as const,
                      call: { id: "load-tasks", name: "tools", input: { names: ["tasks"] } }
                  }

                  return measuredUsage
              }

              if (cycle === 2) {

                  yield {
                      type: "tool-call" as const,
                      call: { id: "create-child", name: "tasks", input: {
                          action: "create",
                          input: "delegated child"
                      } }
                  }

                  return measuredUsage
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

                  return measuredUsage
              }

              assert.equal(JSON.parse(results.at(-1)!.content).output.event, "completed")

              yield { type: "text" as const, content: "delegate work:complete" }

              return measuredUsage
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

              return measuredUsage
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

              return measuredUsage
          }

          assert.equal(request.messages.filter(message => message.role === "tool" && message.name === "time").length, 2)

          yield { type: "text" as const, content: `${input}:complete` }

          return measuredUsage
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

      for (const operation of related.filter(operation => operation.kind === "cycle.completed")) {
          assert.deepEqual(JSON.parse(String(operation.payload)).usage, measuredUsage)
      }

      for (let index = 1; index < related.length; index++) {

          assert.equal(related[index]?.parent_id, related[index - 1]?.id)
      }
  }

  for (const [input, task] of [["first", firstTask], ["second", secondTask]] as const) {

      const recalled = snapshots.get(input)

      assert(recalled?.length)
      assert(recalled.every(snapshot => snapshot.includes(`<task id="${task.id}"`)))
      assert(recalled.every(snapshot => !snapshot.includes('tool="tools"')))
  }

  const recordedInput = operations.find(operation => operation.task_id === firstTask.id)

  assert.deepEqual(JSON.parse(String(recordedInput?.payload)), {
      model: { provider: "test", id: "test-model", contextWindow: null },
      source: { type: "user" },
      input: "first"
  })

  assert(!operations.some(operation => operation.kind === "model.request"))
  assert(!operations.some(operation => String(operation.payload).includes("<perceptual_field")))

  await new Memory(await LemoDatabase.open(database)).record({
      task: firstTask.id, tool: "files", call: "retained-first"
  }, { content: "first task produced its requested file", source: "filesystem:first", method: "files.write" })

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
      && item.selection === "relevant"
  )))

  assert(memoryPayload.output.reduce((size, item) => (
      typeof item === "object" && item !== null && "content" in item
          ? size + estimatedTokens(String(item.content)) + 96
          : size
  ), 0) <= 1_000)

  const observationTask = await lemo.task({ input: "repeat observation", model })

  assert.equal(await observationTask.result(), "observation-loop:stopped")

  const observationOperations = await observationTask.operations()
  const observationResults = observationOperations.filter(operation => operation.kind === "tool.result")
  const repeatedObservation = observationResults.at(-1)?.payload as Record<string, unknown> | undefined

  assert.equal(
      (repeatedObservation?.modelOutput as Record<string, unknown> | undefined)?.status,
      "no-progress"
  )
  assert.equal(
      observationOperations.filter(operation => operation.kind.startsWith("tool.files.observation.")).length,
      2
  )

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

  const restarted = await Lemo.wakeUp(database)

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

  const messageSource = new DatabaseSync(":memory:")
  const messageDatabase = await LemoDatabase.open(messageSource)

  await messageDatabase.createTask("sender", { input: "Coordinate the work" })
  await messageDatabase.appendToTask("sender", "task.run.started", { run: "sender-run" })
  await messageDatabase.createTask("receiver", { input: "Perform the coordinated work" })
  await messageDatabase.appendToTask("receiver", "task.run.started", { run: "receiver-run" })
  const publishedMessages: string[] = []
  const stopMessages = messageDatabase.subscribeMessages(message => publishedMessages.push(message.event))

  for (let index = 0; index < 12; index++) {

      await messageDatabase.sendMessage({
          sourceTask: "sender",
          sourceCall: `message-call-${index}`,
          targetTask: "receiver",
          event: "coordination.progress",
          message: `[directed-message:${String(index).padStart(2, "0")}]`
      })
  }

  stopMessages()
  assert.equal(publishedMessages.length, 12)
  assert(publishedMessages.every(event => event === "coordination.progress"))

  const receiverOperations = (await messageDatabase.operations("receiver", {
      limit: 10,
      order: "oldest"
  })).operations
  const firstMessageContext = await new Memory(messageDatabase).context(receiverOperations)

  assert(firstMessageContext.includes("<inbox "))
  assert(firstMessageContext.includes('event="coordination.progress"'))
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
      event: "coordination.complete",
      message: "This should not be accepted"
  }), /completed Task cannot receive messages/)

  await assert.rejects(messageDatabase.sendMessage({
      sourceTask: "sender",
      sourceCall: "self-message",
      targetTask: "sender",
      event: "coordination.invalid",
      message: "This should not be accepted"
  }), /cannot send a message to itself/)

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
  messageSource.close()
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
}, 120_000)
