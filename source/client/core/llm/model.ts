import type LLMProvider from "./provider"
import type { LLMModelEvent, LLMModelRequest } from "@server/core/llm/model"

/** One local handle to an authoritative LLM Model. */
export default interface LLMModel {
    readonly id: string
    readonly provider: LLMProvider

    generate(request: LLMModelRequest): AsyncGenerator<LLMModelEvent, void, unknown>
}
