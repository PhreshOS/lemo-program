import type { LLMToolDefinition } from "../../llm/model"
import type { MemoryRecord } from "../memory"
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
    task: string
    call: string
    signal: AbortSignal
    record(kind: string, payload: unknown): Promise<Operation>
    memory: Readonly<{
        record(value: MemoryRecord): Promise<Operation>
    }>
    waitAnswer(request: WaitAnswerRequest): Promise<PromptAnswer>
}>
