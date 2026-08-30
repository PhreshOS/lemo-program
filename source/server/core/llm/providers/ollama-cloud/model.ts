import type OllamaCloudProvider from "./provider"
import type LLMModel from "../../model"
import type { LLMModelEvent, LLMModelExecution, LLMModelRequest, LLMReasoningLevels } from "../../model"
import ModelReasoning from "../../reasoning"

export type OllamaModelMetadata = Readonly<{
    contextWindow: number | null
    reasoning: LLMReasoningLevels | null
}>

/** One executable Ollama Cloud Model. */
export default class OllamaCloudModel implements LLMModel {

    private loadedMetadata: OllamaModelMetadata | null = null
    private loadingMetadata: Promise<OllamaModelMetadata> | null = null
    private readonly reasoningState: ModelReasoning

    public constructor(
        public readonly provider: OllamaCloudProvider,
        public readonly id: string,
        private readonly loadMetadata: () => Promise<OllamaModelMetadata>,
        private readonly generateEvents: (
            request: LLMModelRequest,
            reasoning: string | null,
            execution?: LLMModelExecution
        ) => AsyncGenerator<LLMModelEvent, void, unknown>
    ) {

        this.reasoningState = new ModelReasoning(async () => (await this.metadata()).reasoning)
    }

    public get reasoning() {

        return this.reasoningState.level
    }

    public async contextWindow() {

        return (await this.metadata()).contextWindow
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

    private async metadata() {

        if (this.loadedMetadata) return this.loadedMetadata

        if (this.loadingMetadata) return this.loadingMetadata

        this.loadingMetadata = this.loadMetadata()

        try {
            this.loadedMetadata = await this.loadingMetadata

            return this.loadedMetadata
        } finally {
            this.loadingMetadata = null
        }
    }

}
