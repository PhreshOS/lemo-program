import type LLMModel from "./model"
import type { LLMProviderState } from "@server/core/llm/provider"
import type { LLMModelSource } from "./model"

/** One local handle to an authoritative LLM Provider. */
export default interface LLMProvider {
    readonly identity: string
    readonly name: string

    configured(): Promise<boolean>
    active(): Promise<boolean>
    activate(): Promise<void>
    deactivate(): Promise<void>
    models(): Promise<readonly LLMModel[]>
    model(identity: string): LLMModel
}

/** Generic boundary operations used by every concrete Client LLM Provider. */
export interface LLMProviderSource {
    open(providers: readonly string[]): Promise<void>
    close(): void
    subscribe(subscriber: () => void): () => void
    state(identity: string): Promise<LLMProviderState>
    configure(identity: string, value: unknown): Promise<void>
    removeConfiguration(identity: string): Promise<void>
    activate(identity: string): Promise<void>
    deactivate(identity: string): Promise<void>
}

/** Self-registering Client Core entry point owned by one LLM Provider. */
export interface LLMProviderRegistration {
    readonly identity: string
    create(models: LLMModelSource, source: LLMProviderSource): LLMProvider
}
