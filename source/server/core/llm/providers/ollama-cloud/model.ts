import type OllamaCloudProvider from "./provider"
import type LLMModel from "../../model"

/** One executable Ollama Cloud Model. */
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
