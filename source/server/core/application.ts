import type { ProgramStore } from "@phreshos/core"
import ollamaCloudConfiguration, {
    type OllamaCloudConfigurationState
} from "./llm/providers/ollama-cloud/configuration"
import OllamaCloudProvider from "./llm/providers/ollama-cloud/provider"
import type { LLMModelRecord } from "./llm/model"
import { llmProviderActiveKey, llmProviderActiveSchema } from "./llm/provider"
import LLMProviders from "./llm/providers"
import Lemo from "./lemo/lemo"
import type { LemoDatabaseSource } from "./lemo/database"

export default class Application {

    private providers: LLMProviders
    private ollamaCloudActive: boolean

    private constructor(
        private readonly store: ProgramStore,
        providers: LLMProviders,
        ollamaCloudActive: boolean,
        public readonly lemo: Lemo
    ) {

        this.providers = providers

        this.ollamaCloudActive = ollamaCloudActive
    }

    public static async init(store: ProgramStore, database: LemoDatabaseSource) {

        const providers = []

        const ollamaCloud = await store.get(ollamaCloudConfigurationKey)

        const storedActive = await store.get(ollamaCloudActiveKey)

        const active = storedActive === undefined ? true : llmProviderActiveSchema.parse(storedActive)

        if (ollamaCloud !== undefined) {

            if (storedActive === undefined) await store.set(ollamaCloudActiveKey, active)

            providers.push(new OllamaCloudProvider(ollamaCloudConfiguration(ollamaCloud), active))
        }

        const lemo = await Lemo.wakeUp(database)

        return new Application(store, new LLMProviders(providers), active, lemo)
    }

    public get llmProviders() {

        return this.providers
    }

    public ollamaCloudConfiguration(): OllamaCloudConfigurationState {

        return Object.freeze({
            configured: this.providers.get(OllamaCloudProvider.identity) !== null,
            active: this.ollamaCloudActive
        })
    }

    public async configureOllamaCloud(value: unknown): Promise<void> {

        const configuration = ollamaCloudConfiguration(value)

        const provider = new OllamaCloudProvider(configuration, this.ollamaCloudActive)

        await this.store.set(ollamaCloudActiveKey, this.ollamaCloudActive)

        await this.store.set(ollamaCloudConfigurationKey, configuration)

        this.providers = this.providers.with(provider)
    }

    public async removeOllamaCloudConfiguration(): Promise<void> {

        await this.store.delete(ollamaCloudConfigurationKey)

        this.providers = this.providers.without(OllamaCloudProvider.identity)
    }

    public async activateOllamaCloud(): Promise<void> {

        await this.setOllamaCloudActive(true)
    }

    public async deactivateOllamaCloud(): Promise<void> {

        await this.setOllamaCloudActive(false)
    }

    public async modelRecords(): Promise<readonly LLMModelRecord[]> {

        return Object.freeze((await this.providers.models()).map(model => Object.freeze({
            provider: model.provider.identity,
            id: model.id
        })))
    }

    private async setOllamaCloudActive(active: boolean): Promise<void> {

        const stored = await this.store.get(ollamaCloudConfigurationKey)

        const provider = stored === undefined
            ? null
            : new OllamaCloudProvider(ollamaCloudConfiguration(stored), active)

        await this.store.set(ollamaCloudActiveKey, active)

        this.ollamaCloudActive = active

        this.providers = provider
            ? this.providers.with(provider)
            : this.providers.without(OllamaCloudProvider.identity)
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
const ollamaCloudActiveKey = llmProviderActiveKey(OllamaCloudProvider.identity)
