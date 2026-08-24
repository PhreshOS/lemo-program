import type LLMProvider from "./provider"
import type { LLMModelEvent, LLMModelRecord, LLMModelRequest } from "@server/core/llm/model"

/** One local handle to an authoritative LLM Model. */
export default interface LLMModel {
    readonly id: string
    readonly provider: LLMProvider

    generate(request: LLMModelRequest): AsyncGenerator<LLMModelEvent, void, unknown>
}

/** Authoritative Model operations shared by every local LLM Provider handle. */
export interface LLMModelSource {
    models(): Promise<readonly LLMModelRecord[]>
    generate(provider: string, model: string, request: LLMModelRequest): AsyncGenerator<LLMModelEvent, void, unknown>
}
