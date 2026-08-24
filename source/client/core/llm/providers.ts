import type LLMProvider from "./provider"
import type { LLMProviderRegistration, LLMProviderSource } from "./provider"
import type LLMModel from "./model"
import type { LLMModelSource } from "./model"

const modules = import.meta.glob<{ registration: LLMProviderRegistration }>(
    "./providers/*/provider.ts",
    { eager: true }
)

/** Every LLM Provider known specifically by Client Core. */
export default class LLMProviders {

    private readonly providers: ReadonlyMap<string, LLMProvider>

    public constructor(
        private readonly source: LLMModelSource,
        providerSource: LLMProviderSource
    ) {

        const registrations = Object.values(modules)
            .map(module => module.registration)
            .sort((left, right) => left.identity.localeCompare(right.identity))

        this.providers = new Map(registrations.map(registration => [
            registration.identity,
            registration.create(source, providerSource)
        ]))
    }

    public all() {

        return Object.freeze([...this.providers.values()])
    }

    public get(identity: string) {

        return this.providers.get(identity) ?? null
    }

    public async models(): Promise<readonly LLMModel[]> {

        const providers = new Map(this.all().map(provider => [provider.identity, provider]))

        return Object.freeze((await this.source.models()).map(record => {

            const provider = providers.get(record.provider)

            if (!provider) throw new Error(`Server returned an unknown LLM Provider "${record.provider}"`)

            return provider.model(record.id)
        }))
    }
}
