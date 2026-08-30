import type LLMModel from "../../llm/model"
import type { LLMToolCall, LLMToolDefinition } from "../../llm/model"
import type LemoDatabase from "../database"
import type Memory from "../memory"
import type { MemoryRecord } from "../memory"
import type { MemoryRecallOptions, MemoryRecallRequest } from "../memory"
import type Operation from "../operation"
import { assertRunning, waitForRun, type TaskRun } from "../executions"
import type Tool from "./tool"
import type { ToolContext, ToolRecord, ToolTasks } from "./tool"
import {
    approvalRequestSchema,
    approvalResponseSchema,
    type ApprovalResponse
} from "./approval-contract"
import { defaultApproval } from "./tool-approval"
const modules = import.meta.glob<{ default: Tool }>("./tools/*/tool.ts", { eager: true })

/** Lemo's internal owner and executor of available tools. */
export default class Runtime {

    private readonly tools: ReadonlyMap<string, Tool>
    private readonly pending = new Map<string, PendingResponse>()
    private readonly loading = new Map<string, Promise<void>>()

    public constructor(
        private readonly database: LemoDatabase,
        private readonly memory: Memory,
        private readonly taskContext: (invocation: ToolContext["invocation"], model: LLMModel) => ToolTasks
    ) {

        const catalog = Object.values(modules)
            .map(module => module.default)
            .sort((left, right) => (
                (left.order ?? defaultToolOrder) - (right.order ?? defaultToolOrder)
                || left.definition.name.localeCompare(right.definition.name)
            ))

        if (catalog.some(tool => !tool.definition.name.trim())) throw new Error("A Tool name cannot be empty")
        if (new Set(catalog.map(tool => tool.definition.name)).size !== catalog.length) {
            throw new Error("Tool names must be unique")
        }

        this.tools = new Map(catalog.map(tool => [tool.definition.name, tool]))
    }

    /** Reconstructs the tools visible to the next Model cycle. */
    public async definitions(task: string): Promise<readonly LLMToolDefinition[]> {

        const loaded = loadedTools(await this.database.latestOperation(task, "tool.tools.loaded"))

        return Object.freeze([...this.tools.values()]
            .filter(tool => tool.builtin || loaded.has(tool.definition.name))
            .map(tool => tool.definition))
    }

    /** Executes independent tool calls concurrently and records each outcome. */
    public async execute(run: TaskRun, model: LLMModel, calls: readonly LLMToolCall[]) {

        await Promise.all(calls.map(call => this.executeCall(run, model, call)))
    }

    /** Resolves the live Tool call owned by one Task. */
    public respond(task: string, call: string, value: unknown) {

        const pending = this.pending.get(responseKey(task, call))

        if (!pending) throw new Error(`Tool call "${call}" is not awaiting a Client response`)

        pending.resolve(pending.parse(value))
    }

    private async executeCall(run: TaskRun, model: LLMModel, call: LLMToolCall) {

        const tool = this.tools.get(call.name)

        if (!tool) {

            await run.append("tool.result", {
                call: call.id,
                name: call.name,
                ok: false,
                error: `Unknown tool "${call.name}"`
            })

            return
        }

        const record = (kind: string, payload: unknown) => run.append(`tool.${call.name}.${kind}`, {
            call: call.id,
            payload
        })

        let input: unknown

        try {
            const invocation = tool.parse(call.input)

            input = invocation.input

            if (!same(input, call.input)) {

                await run.append("tool.input.normalized", {
                    call: call.id,
                    name: call.name,
                    input
                })
            }

            const mandatory = await tool.approval?.(input) ?? null

            if (mandatory || invocation.approval) {
                const approved = await this.approve(
                    run,
                    call,
                    mandatory ?? defaultApproval(tool.definition.name, input),
                    mandatory ? "tool" : "lemo",
                    record
                )

                if (!approved) {
                    await run.append("tool.result", {
                        call: call.id,
                        name: call.name,
                        ok: false,
                        error: "The user rejected this Tool invocation"
                    })

                    return
                }
            }
        } catch (cause) {
            await appendFailure(run, call, cause)
            return
        }

        const invocation = Object.freeze({
            task: run.task,
            call: call.id,
            signal: run.signal,
            record,
            wait: <Response>(parseResponse: (response: unknown) => Response) => this.wait(
                run,
                call,
                parseResponse,
                record,
                "waiting",
                {}
            )
        })

        const context: ToolContext = Object.freeze({
            invocation,
            memory: Object.freeze({
                recall: (request: MemoryRecallRequest, options?: MemoryRecallOptions) => (
                    this.memory.recall(request, options, {
                        task: run.task,
                        operation: null,
                        call: call.id,
                        source: "tool"
                    })
                ),
                record: (value: MemoryRecord) => {

                    assertRunning(run.signal)

                    return this.memory.record({
                        task: run.task,
                        tool: call.name,
                        call: call.id
                    }, value)
                }
            }),
            tools: Object.freeze({
                list: () => Object.freeze([...this.tools.values()].map(toolRecord)),
                find: (name: string) => {

                    const tool = this.tools.get(name)

                    return tool ? toolRecord(tool) : null
                },
                load: (names: readonly string[]) => this.loadTools(run.task, names, record)
            }),
            tasks: this.taskContext(invocation, model)
        })

        let output: unknown
        const observation = tool.observation?.(input) === true
            ? await this.previousObservation(run.task, call.name, input)
            : null

        try {
            output = await waitForRun(tool.execute(input, context), run.signal)
        } catch (cause) {
            await appendFailure(run, call, cause)
            return
        }

        const noProgress = observation
            ? await this.recordObservation(run, call, observation, output)
            : null

        await run.append("tool.result", {
            call: call.id,
            name: call.name,
            ok: true,
            output,
            ...(noProgress
                ? { modelOutput: noProgress }
                : tool.modelOutput
                    ? { modelOutput: tool.modelOutput(output) }
                    : {})
        })
    }

    private async previousObservation(task: string, tool: string, input: unknown): Promise<Observation> {

        const inputSignature = await signature(input)
        const kind = `tool.${tool}.observation.${inputSignature}`
        const previous = await this.database.latestOperation(task, kind)
        const payload = record(previous?.payload)

        return Object.freeze({
            kind,
            inputSignature,
            previousCall: typeof payload?.call === "string" ? payload.call : null,
            previousOutput: typeof payload?.outputSignature === "string" ? payload.outputSignature : null
        })
    }

    private async recordObservation(
        run: TaskRun,
        call: LLMToolCall,
        observation: Observation,
        output: unknown
    ) {

        const outputSignature = await signature(output)

        await run.append(observation.kind, {
            call: call.id,
            name: call.name,
            inputSignature: observation.inputSignature,
            outputSignature
        })

        if (observation.previousOutput !== outputSignature) return null

        return Object.freeze({
            status: "no-progress",
            tool: call.name,
            previousCall: observation.previousCall,
            message: "This observation is unchanged from the previous equivalent invocation. Use the existing evidence. Change state, inspect a specifically missing scope, or report the blocker; do not repeat the same observation."
        })
    }

    private async approve(
        run: TaskRun,
        call: LLMToolCall,
        approval: Readonly<{ title: string, content: string }>,
        requestedBy: "lemo" | "tool",
        record: (kind: string, payload: unknown) => Promise<Operation>
    ) {

        const request = approvalRequestSchema.parse({ type: "approval", ...approval })

        const answer = await this.wait<ApprovalResponse>(
            run,
            call,
            value => approvalResponseSchema.parse(value),
            record,
            "approval.requested",
            { requestedBy, request }
        )

        await record(`approval.${answer.type}`, { requestedBy })

        return answer.type === "approved"
    }

    private wait<Response>(
        run: TaskRun,
        call: LLMToolCall,
        parseResponse: (response: unknown) => Response,
        announce: (kind: string, payload: unknown) => Promise<Operation>,
        kind: string,
        detail: Readonly<Record<string, unknown>>
    ): Promise<Response> {

        if (this.pending.size >= maximumPendingResponses) {
            throw new Error(`Runtime already has its maximum of ${maximumPendingResponses} pending Tool responses`)
        }

        assertRunning(run.signal)

        const key = responseKey(run.task, call.id)

        if (this.pending.has(key)) throw new Error(`Tool call "${call.id}" is already awaiting a response`)

        const expiresAt = Date.now() + responseTimeout

        return new Promise<Response>((resolve, reject) => {

            let settled = false

            const settle = (action: () => void) => {

                if (settled) return

                settled = true
                clearTimeout(timer)
                run.signal.removeEventListener("abort", abort)
                this.pending.delete(key)
                action()
            }
            const abort = () => settle(() => reject(
                run.signal.reason instanceof Error
                    ? run.signal.reason
                    : new Error("Task run stopped")
            ))
            const timer = setTimeout(() => settle(() => reject(
                new Error(`No Client responded within ${responseTimeout}ms`)
            )), responseTimeout)

            this.pending.set(key, Object.freeze({
                parse: parseResponse,
                resolve: answer => settle(() => resolve(answer as Response)),
                reject: error => settle(() => reject(error))
            }))

            run.signal.addEventListener("abort", abort, { once: true })

            if (run.signal.aborted) {
                abort()
                return
            }

            void announce(kind, { ...detail, expiresAt }).catch(cause => {
                settle(() => reject(cause))
            })
        })
    }

    private async loadTools(
        task: string,
        names: readonly string[],
        record: (kind: string, payload: unknown) => Promise<Operation>
    ) {

        const previous = this.loading.get(task) ?? Promise.resolve()
        let release!: () => void
        const current = new Promise<void>(resolve => { release = resolve })

        this.loading.set(task, current)

        await previous

        try {
            const loaded = loadedTools(await this.database.latestOperation(task, "tool.tools.loaded"))

            for (const name of names) loaded.add(name)

            await record("loaded", { names: [...loaded] })
        } finally {
            release()

            if (this.loading.get(task) === current) this.loading.delete(task)
        }
    }
}

const defaultToolOrder = 1_000
const maximumPendingResponses = 4
const responseTimeout = 2 * 60 * 1_000

type PendingResponse = Readonly<{
    parse(value: unknown): unknown
    resolve(answer: unknown): void
    reject(error: Error): void
}>

function responseKey(task: string, call: string) {

    return `${task}\0${call}`
}

function loadedTools(operation: Operation | null) {

    const loaded = new Set<string>()

    if (!operation || operation.kind !== "tool.tools.loaded") return loaded

    const value = record(operation.payload)

    const payload = record(value?.payload)

    if (!Array.isArray(payload?.names)) return loaded

    for (const name of payload.names) if (typeof name === "string") loaded.add(name)

    return loaded
}

function toolRecord(tool: Tool): ToolRecord {

    return Object.freeze({
        definition: tool.definition,
        docs: tool.docs,
        builtin: tool.builtin === true
    })
}

async function appendFailure(run: TaskRun, call: LLMToolCall, cause: unknown) {

    const error = cause instanceof Error ? cause : new Error(String(cause))

    await run.append("tool.result", {
        call: call.id,
        name: call.name,
        ok: false,
        error: error.message
    })
}

function record(value: unknown) {

    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null
}

function same(left: unknown, right: unknown) {

    return JSON.stringify(left) === JSON.stringify(right)
}

async function signature(value: unknown) {

    const bytes = new TextEncoder().encode(JSON.stringify(value) ?? "undefined")
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))

    return [...digest].map(value => value.toString(16).padStart(2, "0")).join("")
}

type Observation = Readonly<{
    kind: string
    inputSignature: string
    previousCall: string | null
    previousOutput: string | null
}>
