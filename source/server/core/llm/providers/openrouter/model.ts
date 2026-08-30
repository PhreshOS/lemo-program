import type LLMModel from "../../model"
import type { LLMModelEvent, LLMModelExecution, LLMModelRequest, LLMReasoning } from "../../model"
import type OpenRouterProvider from "./provider"

/** One executable OpenRouter LLM Model. */
export default class OpenRouterModel implements LLMModel {

    public constructor(
        public readonly provider: OpenRouterProvider,
        public readonly id: string,
        private readonly reasoningDescription: LLMReasoning | null,
        private readonly generateEvents: (
            request: LLMModelRequest,
            execution?: LLMModelExecution
        ) => AsyncGenerator<LLMModelEvent, void, unknown>
    ) {}

    public async reasoning() {

        return this.reasoningDescription
    }

    public generate(request: LLMModelRequest, execution?: LLMModelExecution) {

        return this.generateEvents(request, execution)
    }
}
