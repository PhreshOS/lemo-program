import type LLMModel from "../llm/model"
import type {
    LLMMessage,
    LLMModelRequest,
    LLMModelUsage,
    LLMToolCall,
    LLMToolDefinition
} from "../llm/model"
import type LemoDatabase from "./database"
import { maximumOperationPage } from "./database"
import { cycleContextBudgets } from "./context"
import type Memory from "./memory"
import type Operation from "./operation"
import { assertRunning, waitForRun, type TaskRun } from "./executions"
import { estimatedTokens, tokenSlice } from "./token-budget"
import system from "./system.md?raw"

/** One disposable Model cycle built from retained history and the active Task's live results. */
export default class Cycle {

    public static async run(
        database: LemoDatabase,
        memory: Memory,
        run: TaskRun,
        model: LLMModel,
        tools: readonly LLMToolDefinition[],
        liveResults: readonly Operation[] = []
    ): Promise<CycleResult> {

        const started = await run.append("cycle.started", {
            run: run.id,
            model: {
                provider: model.provider.identity,
                id: model.id
            }
        })

        try {
            const overhead = estimatedTokens(JSON.stringify({ system, tools })) + 1_024
            const previousResponse = await database.firstOperation(run.task, "model.message")
            const budgets = await cycleContextBudgets(model, previousResponse ? "ongoing" : "initial", overhead)
            const history = await cycleHistory(database, run.task)
            const transcript = await cycleTranscript(database, run.task, budgets.transcript, liveResults)
            const request: LLMModelRequest = Object.freeze({
                messages: Object.freeze([
                    { role: "system" as const, content: system.trim() },
                    { role: "user" as const, content: await memory.context(history, budgets.perceptualField) },
                    ...transcript
                ]),
                tools
            })

            if (estimatedTokens(JSON.stringify(request)) > budgets.input) {
                throw new Error("The Model request exceeds the Task's context budget")
            }

            let output = ""
            const toolCalls: LLMToolCall[] = []
            let usage: LLMModelUsage | null = null

            const events = model.generate(request, { signal: run.signal })
            const iterator = events[Symbol.asyncIterator]()

            try {
                while (true) {

                    const next = await waitForRun(iterator.next(), run.signal)

                    if (next.done) {
                        usage = next.value
                        break
                    }

                    const event = next.value

                    assertRunning(run.signal)

                    await run.append("model.event", event)

                    if (event.type === "text") output += event.content
                    else toolCalls.push(event.call)
                }
            } finally {

                if (run.signal.aborted) {

                    const closing = iterator.return?.(null)

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
                message: message.id,
                usage
            })

            return Object.freeze({ output, toolCalls: Object.freeze(toolCalls), usage })
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

function transcriptMessages(
    operations: readonly Operation[],
    blockTokens: number
): readonly LLMMessage[] {

    const messages: LLMMessage[] = []
    const calls = new Set<string>()

    for (const operation of operations) {

        const payload = record(operation.payload)

        if (operation.kind === "task.input" && typeof payload?.input === "string") {

            messages.push({ role: "user", content: payload.input })
        }

        if (operation.kind === "model.message" && typeof payload?.content === "string") {

            const requested = toolCalls(payload.toolCalls)?.map(call => ({
                ...call, input: boundedValue(call.input, operation, blockTokens)
            }))

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
                content: JSON.stringify(modelToolResult(payload, operation, blockTokens))
            })
        }
    }

    if (!messages.some(message => message.role === "user")) {

        throw new Error("A Task has no valid input operation")
    }

    return Object.freeze(messages.map(message => Object.freeze(message)))
}

async function cycleTranscript(database: LemoDatabase, task: string, maximumTokens: number, liveResults: readonly Operation[]) {

    const live = new Map(liveResults.map(result => [result.id, result]))
    const available = (await database.transcriptOperations(task))
        .map(operation => live.get(operation.id) ?? operation)
    const input = await database.firstOperation(task, "task.input")

    if (!input) throw new Error("A Task has no input operation")

    // Keep the objective, reasoning and every call/result pair. Only payloads
    // become explicit excerpts when the actual Model capacity requires it.
    const transcript = [input, ...available]
    let blockTokens = maximumTokens
    let messages = transcriptMessages(transcript, blockTokens)

    while (estimatedTokens(JSON.stringify(messages)) > maximumTokens && blockTokens > 8) {
        blockTokens = Math.max(8, Math.floor(blockTokens / 2))
        messages = transcriptMessages(transcript, blockTokens)
    }
    if (estimatedTokens(JSON.stringify(messages)) > maximumTokens) {
        throw new Error("The Task conversation exceeds this Model's available context even with Tool payload excerpts; use a Model with a larger context window")
    }
    return Object.freeze(messages)
}

async function cycleHistory(database: LemoDatabase, task: string) {

    let before: number | undefined
    let operations: Operation[] = []

    while (operations.length < taskCycleOperationLimit) {

        const page = await database.operations(task, {
            limit: Math.min(maximumOperationPage, taskCycleOperationLimit - operations.length),
            before,
            order: "newest",
            excludeKinds: ["model.event"]
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

const taskCycleOperationLimit = 1_024

function modelToolResult(payload: Record<string, unknown>, operation: Operation, maximum: number) {
    const value = {
        call: payload.call, name: payload.name, ok: payload.ok,
        ...(payload.ok === true ? { output: payload.notice ?? payload.output } : { error: payload.error }),
        ...(payload.retained === false && payload.transient !== true ? {
            notice: "This result was not saved by the Tool and its live context is unavailable. Read it again when needed; null is not the original result."
        } : {})
    }
    return boundedValue(value, operation, maximum, payload.transient === true)
}

function boundedValue(value: unknown, operation: Operation, maximum: number, transient = false) {
    const serialized = JSON.stringify(value)
    if (serialized === undefined) return null
    const slice = tokenSlice(serialized, maximum)

    if (slice.next === null) return value

    return Object.freeze({
        truncated: true,
        preview: slice.content,
        tokens: slice.total,
        ...(transient ? {
            note: "Live result excerpt. Only Tool-selected data is retained; request a narrower scope for other details.",
            retainedBlock: blockReference(operation)
        } : { block: blockReference(operation) })
    })
}

function blockReference(operation: Operation) {

    return Object.freeze({
        tool: "tasks",
        action: "read_block",
        task: operation.task,
        operation: operation.id,
        offset: 0
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
    usage: LLMModelUsage | null
}>
