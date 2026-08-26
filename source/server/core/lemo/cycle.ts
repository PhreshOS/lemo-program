import type LLMModel from "../llm/model"
import type {
    LLMMessage,
    LLMModelRequest,
    LLMToolCall,
    LLMToolDefinition
} from "../llm/model"
import type LemoDatabase from "./database"
import { maximumOperationPage } from "./database"
import type Memory from "./memory"
import type Operation from "./operation"
import { assertRunning, waitForRun, type TaskRun } from "./executions"
import system from "./system.md?raw"

/** One disposable Model cycle reconstructed entirely from durable operations. */
export default class Cycle {

    public static async run(
        database: LemoDatabase,
        memory: Memory,
        run: TaskRun,
        model: LLMModel,
        tools: readonly LLMToolDefinition[]
    ): Promise<CycleResult> {

        const started = await run.append("cycle.started", {
            run: run.id,
            model: {
                provider: model.provider.identity,
                id: model.id
            }
        })

        try {
            const history = await cycleHistory(database, run.task)
            const transcript = await cycleTranscript(database, run.task)
            const request = modelRequest(transcript, await memory.context(history), tools)

            let output = ""
            const toolCalls: LLMToolCall[] = []

            const events = model.generate(request, { signal: run.signal })
            const iterator = events[Symbol.asyncIterator]()

            try {
                while (true) {

                    const next = await waitForRun(iterator.next(), run.signal)

                    if (next.done) break

                    const event = next.value

                    assertRunning(run.signal)

                    await run.append("model.event", event)

                    if (event.type === "text") output += event.content
                    else toolCalls.push(event.call)
                }
            } finally {

                if (run.signal.aborted) {

                    const closing = iterator.return?.()

                    void closing?.catch(() => {})
                }
            }

            const message = await run.append("model.message", {
                role: "assistant",
                content: output,
                toolCalls
            })

            await run.append("cycle.completed", {
                run: run.id,
                cycle: started.id,
                message: message.id
            })

            return Object.freeze({ output, toolCalls: Object.freeze(toolCalls) })
        } catch (cause) {

            if (run.signal.aborted) throw cause

            const error = cause instanceof Error ? cause : new Error(String(cause))

            await run.append("cycle.failed", {
                run: run.id,
                cycle: started.id,
                error: errorPayload(error)
            })

            throw error
        }
    }
}

function modelRequest(
    operations: readonly Operation[],
    memory: string,
    tools: readonly LLMToolDefinition[]
): LLMModelRequest {

    const messages: LLMMessage[] = [
        { role: "system", content: system.trim() },
        { role: "system", content: memory }
    ]
    const calls = new Set<string>()

    for (const operation of operations) {

        const payload = record(operation.payload)

        if (operation.kind === "task.input" && typeof payload?.input === "string") {

            messages.push({ role: "user", content: payload.input })
        }

        if (operation.kind === "model.message" && typeof payload?.content === "string") {

            const requested = toolCalls(payload.toolCalls)

            for (const call of requested ?? []) calls.add(call.id)

            messages.push({
                role: "assistant",
                content: payload.content,
                toolCalls: requested
            })
        }

        if (operation.kind === "tool.result" && typeof payload?.name === "string") {

            if (typeof payload.call !== "string" || !payload.call) {

                throw new Error("A persisted Tool result has no call identity")
            }

            if (!calls.has(payload.call)) continue

            messages.push({
                role: "tool",
                call: payload.call,
                name: payload.name,
                content: JSON.stringify(modelToolResult(payload))
            })
        }
    }

    if (!messages.some(message => message.role === "user")) {

        throw new Error("A Task has no valid input operation")
    }

    return Object.freeze({
        messages: Object.freeze(messages.map(message => Object.freeze(message))),
        tools
    })
}

async function cycleTranscript(database: LemoDatabase, task: string) {

    const transcript = await database.transcriptOperations(task, maximumTranscriptOperations)
    const input = await database.firstOperation(task, "task.input")

    if (!input) throw new Error("A Task has no input operation")

    return Object.freeze([input, ...transcript])
}

async function cycleHistory(database: LemoDatabase, task: string) {

    let before: number | undefined
    let operations: Operation[] = []

    while (operations.length < taskCycleOperationLimit) {

        const page = await database.operations(task, {
            limit: Math.min(maximumOperationPage, taskCycleOperationLimit - operations.length),
            before,
            order: "newest"
        })

        operations = [...page.operations, ...operations]

        if (page.next === null) break

        before = page.next
    }

    const input = await database.firstOperation(task, "task.input")

    return input && !operations.some(operation => operation.id === input.id)
        ? Object.freeze([input, ...operations])
        : Object.freeze(operations)
}

const maximumTranscriptOperations = 512
const taskCycleOperationLimit = 1_024

function modelToolResult(payload: Record<string, unknown>) {

    if (payload.ok !== true || !("modelOutput" in payload)) return payload

    return Object.freeze({
        call: payload.call,
        name: payload.name,
        ok: true,
        output: payload.modelOutput
    })
}

function toolCalls(value: unknown): readonly LLMToolCall[] | undefined {

    if (value === undefined) return undefined

    if (!Array.isArray(value)) throw new Error("A persisted assistant message has invalid tool calls")

    return Object.freeze(value.map(item => {

        const call = record(item)

        if (typeof call?.id !== "string" || typeof call.name !== "string") {

            throw new Error("A persisted assistant message has an invalid tool call")
        }

        return Object.freeze({ id: call.id, name: call.name, input: call.input })
    }))
}

function errorPayload(error: Error) {

    return {
        name: error.name,
        message: error.message,
        stack: error.stack ?? null
    }
}

function record(value: unknown) {

    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null
}

export type CycleResult = Readonly<{
    output: string
    toolCalls: readonly LLMToolCall[]
}>
