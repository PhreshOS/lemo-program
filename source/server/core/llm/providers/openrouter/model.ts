import type LLMModel from "../../model"
import type { LLMModelEvent, LLMModelExecution, LLMModelRequest, LLMReasoningLevels } from "../../model"
import ModelReasoning from "../../reasoning"
import type OpenRouterProvider from "./provider"

/** One executable OpenRouter LLM Model. */
export default class OpenRouterModel implements LLMModel {

    private readonly reasoningState: ModelReasoning

    public constructor(
        public readonly provider: OpenRouterProvider,
        public readonly id: string,
        private readonly contextWindowValue: number | null,
        private readonly reasoningDescription: LLMReasoningLevels | null,
        reasoning: string | null,
        private readonly generateEvents: (
            request: LLMModelRequest,
            reasoning: string | null,
            execution?: LLMModelExecution
        ) => AsyncGenerator<LLMModelEvent, void, unknown>
    ) {

        this.reasoningState = new ModelReasoning(async () => this.reasoningDescription, reasoning)
    }

    public get reasoning() {

        return this.reasoningState.level
    }

    public async contextWindow() {

        return this.contextWindowValue
    }

    public reasoningLevels() {

        return this.reasoningState.levels()
    }

    public setReasoning(level: string | null) {

        return this.reasoningState.set(level)
    }

    public generate(request: LLMModelRequest, execution?: LLMModelExecution) {

        return this.generateEvents(request, this.reasoning, execution)
    }
}
