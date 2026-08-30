import type LLMModel from "../../model"
import type { LLMModelEvent, LLMModelExecution, LLMModelRequest, LLMReasoningLevels } from "../../model"
import ModelReasoning from "../../reasoning"
import type OpenCodeProvider from "./provider"

export type OpenCodeProtocol = "chat-completions" | "responses"

/** One anonymous OpenCode Zen Model. */
export default class OpenCodeModel implements LLMModel {

    private readonly reasoningState: ModelReasoning

    public constructor(
        public readonly provider: OpenCodeProvider,
        public readonly id: string,
        public readonly protocol: OpenCodeProtocol,
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
