import type OllamaCloudProvider from "./provider"
import type LLMModel from "../../model"
import type { LLMModelEvent, LLMModelExecution, LLMModelRequest } from "../../model"

/** One executable Ollama Cloud Model. */
export default class OllamaCloudModel implements LLMModel {

    public constructor(
        public readonly provider: OllamaCloudProvider,
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
