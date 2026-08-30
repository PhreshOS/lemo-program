import type {
    OllamaCloudConfiguration
} from "@server/core/llm/providers/ollama-cloud/configuration"
import OllamaCloudModel from "./model"
import type LLMProvider from "../../provider"
import type { LLMProviderRegistration, LLMProviderSource } from "../../provider"
import type { LLMModelSource } from "../../model"

/** One local configuration and Model handle for Ollama Cloud. */
export default class OllamaCloudProvider implements LLMProvider {

    public readonly identity = "ollama-cloud"
    public readonly name = "Ollama Cloud"

    private readonly retainedModels = new Map<string, OllamaCloudModel>()

    public constructor(
        private readonly modelsSource: LLMModelSource,
        private readonly source: LLMProviderSource
    ) {}

    public async configured() {

        return (await this.source.state(this.identity)).configured
    }

    public async active() {

        return (await this.source.state(this.identity)).active
    }

    public state() {

        return this.source.state(this.identity)
    }

    public async configure(configuration: OllamaCloudConfiguration): Promise<void> {

        await this.source.configure(this.identity, configuration)
    }

    public async removeConfiguration(): Promise<void> {

        await this.source.removeConfiguration(this.identity)
    }

    public async activate(): Promise<void> {

        await this.source.activate(this.identity)
    }

    public async deactivate(): Promise<void> {

        await this.source.deactivate(this.identity)
    }

    public async models(): Promise<readonly OllamaCloudModel[]> {

        return Object.freeze((await this.modelsSource.models())
            .filter(record => record.provider === this.identity)
            .map(record => this.model(record.id, record.reasoning)))
    }

    public model(identity: string, reasoning?: string | null) {

        let model = this.retainedModels.get(identity)

        if (!model) {

            model = new OllamaCloudModel(
                this,
                identity,
                reasoning ?? null,
                () => this.modelsSource.contextWindow(this.identity, identity),
                () => this.modelsSource.reasoningLevels(this.identity, identity),
                level => this.modelsSource.setReasoning(this.identity, identity, level),
                request => this.modelsSource.generate(this.identity, identity, request)
            )

            this.retainedModels.set(identity, model)
        }

        if (reasoning !== undefined) model.synchronizeReasoning(reasoning)

        return model
    }
}

export const registration: LLMProviderRegistration = Object.freeze({
    identity: "ollama-cloud",
    create: (models: LLMModelSource, source: LLMProviderSource) => new OllamaCloudProvider(models, source)
})
