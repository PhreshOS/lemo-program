import type { LLMToolDefinition } from "../../llm/model"
import type {
    OperationPage,
    TaskListRequest,
    TaskPage,
    TaskSummary
} from "../database"
import type { MemoryRecord } from "../memory"
import type { MemoryRecallOptions, MemoryRecallRequest, MemoryResult } from "../memory"
import type Operation from "../operation"
import type { PromptAnswer, WaitAnswerRequest } from "./prompt-contract"

/** One Runtime-owned capability exposed to LLM Models. */
export default interface Tool {
    readonly definition: LLMToolDefinition
    readonly docs: string

    execute(input: unknown, context: ToolContext): Promise<unknown>

    /**
     * Defines the Tool-owned durable representation used in Model context.
     * The raw output is always preserved independently; omission excludes a
     * successful result from later associative context.
     */
    modelOutput?(output: unknown): unknown
}

export type ToolContext = Readonly<{
    invocation: Readonly<{
        task: string
        call: string
        signal: AbortSignal
        record(kind: string, payload: unknown): Promise<Operation>
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
    client: Readonly<{
        waitAnswer(request: WaitAnswerRequest): Promise<PromptAnswer>
    }>
}>

export type ToolRecord = Readonly<{
    definition: LLMToolDefinition
    docs: string
}>

export type ToolTasks = Readonly<{
    list(request: TaskListRequest): Promise<TaskPage>
    read(task: string, limit: number, before?: number): Promise<Readonly<{
        task: TaskSummary
        operations: OperationPage
    }>>
    create(input: string): Promise<TaskSummary>
    pause(task: string): Promise<TaskSummary>
    continue(task: string): Promise<TaskSummary>
    cancel(task: string): Promise<TaskSummary>
    wait(request: TaskWaitRequest): Promise<TaskEvent>
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
