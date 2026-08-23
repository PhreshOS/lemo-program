import type { LLMToolDefinition } from "../../llm/model"
import type Operation from "../operation"

/** One Runtime-owned capability exposed to LLM Models. */
export default interface Tool {
    readonly definition: LLMToolDefinition
    readonly docs: string

    execute(input: unknown, context: ToolContext): Promise<unknown>
}

export type ToolContext = Readonly<{
    task: string
    call: string
    record(kind: string, payload: unknown): Promise<Operation>
}>
