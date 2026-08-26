import type LLMModel from "../../model"
import type { LLMModelEvent, LLMModelExecution, LLMModelRequest } from "../../model"
import type OpenRouterProvider from "./provider"

/** One executable OpenRouter LLM Model. */
export default class OpenRouterModel implements LLMModel {

    public constructor(
        public readonly provider: OpenRouterProvider,
        public readonly id: string,
        private readonly generateEvents: (
            request: LLMModelRequest,
            execution?: LLMModelExecution
        ) => AsyncGenerator<LLMModelEvent, void, unknown>
    ) {}

    public generate(request: LLMModelRequest, execution?: LLMModelExecution) {

        return this.generateEvents(request, execution)
    }
}
