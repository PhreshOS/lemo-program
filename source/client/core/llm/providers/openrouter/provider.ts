import type { OpenRouterConfiguration } from "@server/core/llm/providers/openrouter/configuration"
import type LLMProvider from "../../provider"
import type { LLMProviderRegistration, LLMProviderSource } from "../../provider"
import type { LLMModelSource } from "../../model"
import OpenRouterModel from "./model"

/** One local configuration and Model handle for OpenRouter. */
export default class OpenRouterProvider implements LLMProvider {

    public readonly identity = "openrouter"
    public readonly name = "OpenRouter"

    private readonly retainedModels = new Map<string, OpenRouterModel>()

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

    public async configure(configuration: OpenRouterConfiguration): Promise<void> {

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

    public async models(): Promise<readonly OpenRouterModel[]> {

        return Object.freeze((await this.modelsSource.models())
            .filter(record => record.provider === this.identity)
            .map(record => this.model(record.id)))
    }

    public model(identity: string) {

        let model = this.retainedModels.get(identity)

        if (!model) {
            model = new OpenRouterModel(
                this,
                identity,
                () => this.modelsSource.reasoning(this.identity, identity),
                request => this.modelsSource.generate(this.identity, identity, request)
            )

            this.retainedModels.set(identity, model)
        }

        return model
    }
}

export const registration: LLMProviderRegistration = Object.freeze({
    identity: "openrouter",
    create: (models: LLMModelSource, source: LLMProviderSource) => new OpenRouterProvider(models, source)
})
