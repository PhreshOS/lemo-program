import type OllamaCloudProvider from "./provider"
import type LLMModel from "../../model"
import type { LLMModelEvent, LLMModelExecution, LLMModelRequest, LLMReasoning } from "../../model"

/** One executable Ollama Cloud Model. */
export default class OllamaCloudModel implements LLMModel {

    private loadedReasoning: LLMReasoning | null | undefined
    private loadingReasoning: Promise<LLMReasoning | null> | null = null

    public constructor(
        public readonly provider: OllamaCloudProvider,
        public readonly id: string,
        private readonly loadReasoning: () => Promise<LLMReasoning | null>,
        private readonly generateEvents: (
            request: LLMModelRequest,
            execution?: LLMModelExecution
        ) => AsyncGenerator<LLMModelEvent, void, unknown>
    ) {}

    public async reasoning() {

        if (this.loadedReasoning !== undefined) return this.loadedReasoning

        if (this.loadingReasoning) return this.loadingReasoning

        this.loadingReasoning = this.loadReasoning()

        try {
            this.loadedReasoning = await this.loadingReasoning

            return this.loadedReasoning
        } finally {
            this.loadingReasoning = null
        }
    }

    public generate(request: LLMModelRequest, execution?: LLMModelExecution) {

        return this.generateEvents(request, execution)
    }
}
