import type { LLMModelEvent, LLMModelRequest, LLMModelUsage, LLMReasoningLevels } from "@server/core/llm/model"
import type LLMModel from "../../model"
import ModelReasoning from "../../reasoning"
import type OpenRouterProvider from "./provider"

/** One local OpenRouter LLM Model handle. */
export default class OpenRouterModel implements LLMModel {

    private readonly reasoningState: ModelReasoning

    public constructor(
        public readonly provider: OpenRouterProvider,
        public readonly id: string,
        reasoning: string | null,
        private readonly loadContextWindow: () => Promise<number | null>,
        private readonly loadReasoning: () => Promise<LLMReasoningLevels | null>,
        changeReasoning: (level: string | null) => Promise<void>,
        private readonly generateEvents: (request: LLMModelRequest) => AsyncGenerator<LLMModelEvent, LLMModelUsage | null, unknown>
    ) {

        this.reasoningState = new ModelReasoning(reasoning, changeReasoning)
    }

    public get reasoning() {

        return this.reasoningState.level
    }

    public contextWindow() {

        return this.loadContextWindow()
    }

    public reasoningLevels() {

        return this.loadReasoning()
    }

    public setReasoning(level: string | null) {

        return this.reasoningState.set(level)
    }

    public synchronizeReasoning(level: string | null) {

        this.reasoningState.synchronize(level)
    }

    public generate(request: LLMModelRequest) {

        return this.generateEvents(request)
    }
}
