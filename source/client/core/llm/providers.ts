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
    private readonly subscribers = new Set<() => void>()
    private initialization: Promise<void> | null = null
    private revisionValue = 0

    public constructor(
        private readonly source: LLMModelSource,
        private readonly providerSource: LLMProviderSource
    ) {

        const registrations = Object.values(modules)
            .map(module => module.registration)
            .sort((left, right) => left.identity.localeCompare(right.identity))

        this.providers = new Map(registrations.map(registration => [
            registration.identity,
            registration.create(source, providerSource)
        ]))

        providerSource.subscribe(() => {

            this.revisionValue++

            for (const subscriber of this.subscribers) subscriber()
        })
    }

    public all() {

        return Object.freeze([...this.providers.values()])
    }

    public get(identity: string) {

        return this.providers.get(identity) ?? null
    }

    public async models(): Promise<readonly LLMModel[]> {

        await this.start()

        const providers = new Map(this.all().map(provider => [provider.identity, provider]))

        return Object.freeze((await this.source.models()).map(record => {

            const provider = providers.get(record.provider)

            if (!provider) throw new Error(`Server returned an unknown LLM Provider "${record.provider}"`)

            return provider.model(record.id, record.reasoning)
        }))
    }

    public start() {

        if (!this.initialization) {
            this.initialization = this.providerSource.open([...this.providers.keys()]).catch(cause => {

                this.initialization = null

                throw cause
            })
        }

        return this.initialization
    }

    public stop() {

        this.providerSource.close()
        this.initialization = null
    }

    public revision() {

        return this.revisionValue
    }

    public subscribe(subscriber: () => void) {

        this.subscribers.add(subscriber)

        return () => { this.subscribers.delete(subscriber) }
    }
}
