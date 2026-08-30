import type { LLMToolDefinition } from "../../llm/model"
import type {
    TaskListRequest,
    TaskMessage,
    TaskPage,
    TaskSummary
} from "../database"
import type { MemoryRecord } from "../memory"
import type {
    MemoryRecallOptions,
    MemoryRecallRequest,
    MemoryResult,
    OperationBlockPage,
    TaskContextPage
} from "../memory"
import type Operation from "../operation"

/** One Runtime-owned capability exposed to LLM Models. */
export default interface Tool {
    readonly definition: LLMToolDefinition
    readonly docs: string
    readonly builtin?: boolean
    readonly order?: number

    /** Normalizes and validates one approval-aware Model invocation. */
    parse(input: unknown): ToolInvocation

    /** Requires approval for a normalized invocation before execute is entered. */
    approval?(input: unknown): ToolApproval | null | Promise<ToolApproval | null>

    /** Identifies read-only invocations whose unchanged repetition is not progress. */
    observation?(input: unknown): boolean

    execute(input: unknown, context: ToolContext): Promise<unknown>

    /**
     * Defines the Tool-owned durable representation used in Model context.
     * The raw output is always preserved independently; omission excludes a
     * successful result from later associative context.
     */
    modelOutput?(output: unknown): unknown
}

export type ToolInvocation = Readonly<{
    input: unknown
    approval: boolean
}>

export type ToolApproval = Readonly<{
    title: string
    content: string
}>

export type ToolContext = Readonly<{
    invocation: Readonly<{
        task: string
        call: string
        signal: AbortSignal
        record(kind: string, payload: unknown): Promise<Operation>
        wait<Response>(parseResponse: (response: unknown) => Response): Promise<Response>
    }>
    memory: Readonly<{
        recall(request: MemoryRecallRequest, options?: MemoryRecallOptions): Promise<readonly MemoryResult[]>
        record(value: MemoryRecord): Promise<Operation>
    }>
    tools: Readonly<{
        list(): readonly ToolRecord[]
        find(name: string): ToolRecord | null
        load(names: readonly string[]): Promise<void>
    }>
    tasks: ToolTasks
}>

export type ToolRecord = Readonly<{
    definition: LLMToolDefinition
    docs: string
    builtin: boolean
}>

export type ToolTasks = Readonly<{
    list(request: TaskListRequest): Promise<TaskPage>
    read(task: string, tokens?: number, before?: number): Promise<TaskContextPage>
    readBlock(task: string, operation: string, offset?: number, tokens?: number): Promise<OperationBlockPage>
    create(input: string): Promise<TaskSummary>
    send(task: string, event: string, message: string): Promise<TaskMessage>
    pause(task: string): Promise<TaskSummary>
    continue(task: string): Promise<TaskSummary>
    cancel(task: string): Promise<TaskSummary>
    wait(request: TaskWaitRequest): Promise<TaskEvent>
    waitMessage(event: string, timeout?: number): Promise<TaskMessage>
}>

export type TaskEventName = "created" | "running" | "paused" | "continued" | "completed" | "failed" | "cancelled"

export type TaskWaitRequest = Readonly<{
    tasks?: readonly string[]
    events?: readonly TaskEventName[]
    timeout?: number
}>

export type TaskEvent = Readonly<{
    task: string
    event: TaskEventName
    operation: string
    createdAt: number
}>
