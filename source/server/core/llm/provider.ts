import { z } from "zod"
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

export function llmProviderActiveKey(identity: string) {

    return `${identity}:active`
}
