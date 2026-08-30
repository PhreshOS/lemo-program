import type LLMModel from "../../model"
import type OllamaCloudProvider from "./provider"
import type { LLMModelEvent, LLMModelRequest, LLMReasoning } from "@server/core/llm/model"

/** One local Ollama Cloud Model handle. */
export default class OllamaCloudModel implements LLMModel {

    public constructor(
        public readonly provider: OllamaCloudProvider,
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
