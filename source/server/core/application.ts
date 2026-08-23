import type { ProgramStore } from "@phreshos/core"
import ollamaCloudConfiguration, {
    type OllamaCloudConfigurationState
} from "./llm/providers/ollama-cloud/configuration"
import OllamaCloudProvider from "./llm/providers/ollama-cloud/provider"
import type { LLMModelRecord } from "./llm/model"
import LLMProviders from "./llm/providers"

export default class Application {

    private providers: LLMProviders

    private constructor(private readonly store: ProgramStore, providers: LLMProviders) {

        this.providers = providers
    }

    public static async init(store: ProgramStore) {

        const providers = []

        const ollamaCloud = await store.get(ollamaCloudConfigurationKey)

        if (ollamaCloud !== undefined) {

            providers.push(new OllamaCloudProvider(ollamaCloudConfiguration(ollamaCloud)))
        }

        return new Application(store, new LLMProviders(providers))
    }

    public get llmProviders() {

        return this.providers
    }

    public ollamaCloudConfiguration(): OllamaCloudConfigurationState {

        return Object.freeze({
            configured: this.providers.get(OllamaCloudProvider.identity) !== null
        })
    }

    public async configureOllamaCloud(value: unknown): Promise<void> {

        const configuration = ollamaCloudConfiguration(value)

        const provider = new OllamaCloudProvider(configuration)

        await this.store.set(ollamaCloudConfigurationKey, configuration)

        this.providers = this.providers.with(provider)
    }

    public async removeOllamaCloudConfiguration(): Promise<void> {

        await this.store.delete(ollamaCloudConfigurationKey)

        this.providers = this.providers.without(OllamaCloudProvider.identity)
    }

    public async modelRecords(providerIdentity: string): Promise<readonly LLMModelRecord[]> {

        const provider = this.providers.get(providerIdentity)

        if (!provider) throw new Error(`LLM Provider "${providerIdentity}" is not configured`)

        return Object.freeze((await provider.models()).map(model => Object.freeze({ id: model.id })))
    }

    public async *generate(providerIdentity: string, modelIdentity: string, input: string) {

        const model = await this.providers.model(providerIdentity, modelIdentity)

        if (!model) throw new Error(`Unknown LLM Model "${providerIdentity}/${modelIdentity}"`)

        yield* model.generate(input)
    }

    public name() {

        return "Lemo"
    }
}

const ollamaCloudConfigurationKey = `${OllamaCloudProvider.identity}:config`
