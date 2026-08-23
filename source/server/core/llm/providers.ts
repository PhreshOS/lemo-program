import type LLMProvider from "./provider"
import type LLMModel from "./model"

/** Retains the initialized LLM Providers and resolves their Models. */
export default class LLMProviders {

    private readonly providers: ReadonlyMap<string, LLMProvider>

    public constructor(providers: readonly LLMProvider[]) {

        if (providers.some(provider => !provider.identity.trim())) throw new Error("An LLM Provider identity cannot be empty")

        if (new Set(providers.map(provider => provider.identity)).size !== providers.length) {

            throw new Error("LLM Provider identities must be unique")
        }

        this.providers = new Map(providers.map(provider => [provider.identity, provider]))
    }

    public all() {

        return Object.freeze([...this.providers.values()])
    }

    public get(identity: string) {

        return this.providers.get(identity) ?? null
    }

    public with(provider: LLMProvider) {

        return new LLMProviders([
            ...this.all().filter(candidate => candidate.identity !== provider.identity),
            provider
        ])
    }

    public without(identity: string) {

        return new LLMProviders(this.all().filter(provider => provider.identity !== identity))
    }

    public async model(providerIdentity: string, modelIdentity: string): Promise<LLMModel | null> {

        const provider = this.get(providerIdentity)

        if (!provider) return null

        return (await provider.models()).find(model => model.id === modelIdentity) ?? null
    }
}
