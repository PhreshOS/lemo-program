import { z } from "zod"
import type { ProgramStore } from "@phreshos/core"
import type LLMModel from "./model"

export const llmProviderActiveSchema = z.boolean()

/** One language-model Provider and the LLM Models it owns. */
export default interface LLMProvider {
    /** Stable identity used to address this LLM Provider. */
    readonly identity: string

    /** Human-readable LLM Provider name. */
    readonly name: string

    /** Whether this configured LLM Provider contributes Models. */
    readonly active: boolean

    /** Returns the LLM Models currently available through this Provider. */
    models(): Promise<readonly LLMModel[]>
}

export type LLMProviderState = Readonly<{
    configured: boolean
    active: boolean
}>

/** Provider-owned authoritative state used by the LLM Provider collection. */
export interface LLMProviderHandle {
    readonly identity: string
    readonly provider: LLMProvider | null

    state(): LLMProviderState
    configure(value: unknown): Promise<void>
    removeConfiguration(): Promise<void>
    activate(): Promise<void>
    deactivate(): Promise<void>
}

/** Self-registering Server Core entry point owned by one LLM Provider. */
export interface LLMProviderRegistration {
    readonly identity: string
    open(store: ProgramStore): Promise<LLMProviderHandle>
}

export function llmProviderActiveKey(identity: string) {

    return `${identity}:active`
}
