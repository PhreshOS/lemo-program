import type { ProgramStore } from "@phreshos/core"
import type LLMProvider from "./provider"
import type { LLMProviderHandle, LLMProviderRegistration, LLMProviderState } from "./provider"
import type LLMModel from "./model"

const modules = import.meta.glob<{ registration: LLMProviderRegistration }>(
    "./providers/*/provider.ts",
    { eager: true }
)

/** Retains the initialized LLM Providers and resolves their Models. */
export default class LLMProviders {

    private readonly providers: ReadonlyMap<string, LLMProvider>
    private readonly handles: ReadonlyMap<string, LLMProviderHandle>

    public constructor(
        providers: readonly LLMProvider[],
        handles: readonly LLMProviderHandle[] = []
    ) {

        const identities = [
            ...providers.map(provider => provider.identity),
            ...handles.map(handle => handle.identity)
        ]

        if (identities.some(identity => !identity.trim())) throw new Error("An LLM Provider identity cannot be empty")

        if (new Set(identities).size !== identities.length) {

            throw new Error("LLM Provider identities must be unique")
        }

        this.providers = new Map(providers.map(provider => [provider.identity, provider]))
        this.handles = new Map(handles.map(handle => [handle.identity, handle]))
    }

    public static async init(store: ProgramStore) {

        const registrations = Object.values(modules)
            .map(module => module.registration)
            .sort((left, right) => left.identity.localeCompare(right.identity))

        const handles: LLMProviderHandle[] = []

        for (const registration of registrations) handles.push(await registration.open(store))

        return new LLMProviders([], handles)
    }

    public all() {

        return Object.freeze([
            ...this.providers.values(),
            ...[...this.handles.values()].flatMap(handle => handle.provider ? [handle.provider] : [])
        ])
    }

    public get(identity: string) {

        return this.providers.get(identity) ?? this.handles.get(identity)?.provider ?? null
    }

    public state(identity: string): LLMProviderState {

        return this.handle(identity).state()
    }

    public configure(identity: string, value: unknown) {

        return this.handle(identity).configure(value)
    }

    public removeConfiguration(identity: string) {

        return this.handle(identity).removeConfiguration()
    }

    public activate(identity: string) {

        return this.handle(identity).activate()
    }

    public deactivate(identity: string) {

        return this.handle(identity).deactivate()
    }

    public async models(): Promise<readonly LLMModel[]> {

        const models = await Promise.all(this.all()
            .filter(provider => provider.active)
            .map(provider => provider.models()))

        return Object.freeze(models.flat())
    }

    public async model(providerIdentity: string, modelIdentity: string): Promise<LLMModel | null> {

        const provider = this.get(providerIdentity)

        if (!provider?.active) return null

        return (await provider.models()).find(model => model.id === modelIdentity) ?? null
    }

    private handle(identity: string) {

        const handle = this.handles.get(identity)

        if (!handle) throw new Error(`Unknown LLM Provider "${identity}"`)

        return handle
    }
}
