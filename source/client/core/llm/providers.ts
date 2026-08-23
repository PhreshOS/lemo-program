import OllamaCloudProvider, {
    type OllamaCloudSource
} from "./providers/ollama-cloud/provider"

/** Every LLM Provider known specifically by Client Core. */
export default class LLMProviders {

    public readonly ollamaCloud: OllamaCloudProvider

    public constructor(source: OllamaCloudSource) {

        this.ollamaCloud = new OllamaCloudProvider(source)
    }

    public all() {

        return Object.freeze([this.ollamaCloud])
    }
}
