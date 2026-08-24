import type { LLMToolDefinition } from "../../llm/model"
import type { MemoryRecord } from "../memory"
import type Operation from "../operation"
import type { WaitAnswerRequest } from "./wait-answers"

/** One Runtime-owned capability exposed to LLM Models. */
export default interface Tool {
    readonly definition: LLMToolDefinition
    readonly docs: string

    execute(input: unknown, context: ToolContext): Promise<unknown>

    /** Optionally reduces a raw result only for the next Model context. */
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
    waitAnswer(request: WaitAnswerRequest): Promise<string>
}>
