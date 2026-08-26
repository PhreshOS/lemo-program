import type LLMModel from "../../llm/model"
import type { LLMToolCall, LLMToolDefinition } from "../../llm/model"
import type LemoDatabase from "../database"
import type Memory from "../memory"
import type { MemoryRecord } from "../memory"
import type { MemoryRecallOptions, MemoryRecallRequest } from "../memory"
import type Operation from "../operation"
import { assertRunning, waitForRun, type TaskRun } from "../executions"
import type ClientChannel from "@server/core/client-channel"
import type Tool from "./tool"
import type { ToolContext, ToolRecord, ToolTasks } from "./tool"
import { defaultApproval } from "./tool-approval"
import { waitAnswerRequestSchema, type WaitAnswerRequest } from "./prompt-contract"
import WaitAnswers from "./wait-answers"
const modules = import.meta.glob<{ default: Tool }>("./tools/*/*.ts", { eager: true })

/** Lemo's internal owner and executor of available tools. */
export default class Runtime {

    private readonly tools: ReadonlyMap<string, Tool>
    private readonly answers: WaitAnswers
    private readonly loading = new Map<string, Promise<void>>()

    public constructor(
        private readonly database: LemoDatabase,
        private readonly memory: Memory,
        client: ClientChannel,
        private readonly taskContext: (invocation: ToolContext["invocation"], model: LLMModel) => ToolTasks
    ) {

        this.answers = new WaitAnswers(client)

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
            record
        })

        const context: ToolContext = Object.freeze({
            invocation,
            memory: Object.freeze({
                recall: (request: MemoryRecallRequest, options?: MemoryRecallOptions) => (
                    this.memory.recall(request, options)
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
            tasks: this.taskContext(invocation, model),
            client: Object.freeze({
                waitAnswer: (request: WaitAnswerRequest) => this.answers.wait({
                    task: run.task,
                    call: call.id
                }, request, run.signal)
            })
        })

        let output: unknown

        try {
            output = await waitForRun(tool.execute(input, context), run.signal)
        } catch (cause) {
            await appendFailure(run, call, cause)
            return
        }

        await run.append("tool.result", {
            call: call.id,
            name: call.name,
            ok: true,
            output,
            ...(tool.modelOutput ? { modelOutput: tool.modelOutput(output) } : {})
        })
    }

    private async approve(
        run: TaskRun,
        call: LLMToolCall,
        approval: Readonly<{ title: string, content: string }>,
        requestedBy: "lemo" | "tool",
        record: (kind: string, payload: unknown) => Promise<Operation>
    ) {

        const request = waitAnswerRequestSchema.parse({ type: "approval", ...approval })

        await record("approval.requested", { requestedBy, request })

        const answer = await this.answers.wait({ task: run.task, call: call.id }, request, run.signal)

        await record(`approval.${answer.type}`, { requestedBy })

        return answer.type === "approved"
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
