import type { LLMModelEvent, LLMModelRequest, LLMReasoning } from "@server/core/llm/model"
import type LLMModel from "../../model"
import type OpenRouterProvider from "./provider"

/** One local OpenRouter LLM Model handle. */
export default class OpenRouterModel implements LLMModel {

    public constructor(
        public readonly provider: OpenRouterProvider,
        public readonly id: string,
        private readonly loadReasoning: () => Promise<LLMReasoning | null>,
        private readonly generateEvents: (request: LLMModelRequest) => AsyncGenerator<LLMModelEvent, void, unknown>
    ) {}

    public reasoning() {

        return this.loadReasoning()
    }

    public generate(request: LLMModelRequest) {

        return this.generateEvents(request)
    }
}
