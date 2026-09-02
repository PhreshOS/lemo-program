import type LLMProvider from "./provider"
import type { LLMModelEvent, LLMModelRecord, LLMModelRequest, LLMModelUsage, LLMReasoningLevels } from "@server/core/llm/model"

/** One local handle to an authoritative LLM Model. */
export default interface LLMModel {
    readonly id: string
    readonly provider: LLMProvider
    readonly reasoning: string | null

    contextWindow(): Promise<number | null>
    reasoningLevels(): Promise<LLMReasoningLevels | null>
    setReasoning(level: string | null): Promise<void>
    generate(request: LLMModelRequest): AsyncGenerator<LLMModelEvent, LLMModelUsage | null, unknown>
}

/** Authoritative Model operations shared by every local LLM Provider handle. */
export interface LLMModelSource {
    models(): Promise<readonly LLMModelRecord[]>
    contextWindow(provider: string, model: string): Promise<number | null>
    reasoningLevels(provider: string, model: string): Promise<LLMReasoningLevels | null>
    setReasoning(provider: string, model: string, level: string | null): Promise<void>
    generate(provider: string, model: string, request: LLMModelRequest): AsyncGenerator<LLMModelEvent, LLMModelUsage | null, unknown>
}
