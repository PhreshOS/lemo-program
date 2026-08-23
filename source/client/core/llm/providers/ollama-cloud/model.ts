import type LLMModel from "../../model"
import type OllamaCloudProvider from "./provider"

/** One local Ollama Cloud Model handle. */
export default class OllamaCloudModel implements LLMModel {

    public constructor(
        public readonly provider: OllamaCloudProvider,
        public readonly id: string,
        private readonly generateText: (input: string) => AsyncGenerator<string, void, unknown>
    ) {}

    public generate(input: string) {

        return this.generateText(input)
    }
}
