import type OllamaCloudProvider from "./provider"
import type LLMModel from "../../model"
import type { LLMModelEvent, LLMModelRequest } from "../../model"

/** One executable Ollama Cloud Model. */
export default class OllamaCloudModel implements LLMModel {

    public constructor(
        public readonly provider: OllamaCloudProvider,
        public readonly id: string,
        private readonly generateEvents: (request: LLMModelRequest) => AsyncGenerator<LLMModelEvent, void, unknown>
    ) {}

    public generate(request: LLMModelRequest) {

        return this.generateEvents(request)
    }
}
