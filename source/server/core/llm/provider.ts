import type LLMModel from "./model"

/** One language-model Provider and the LLM Models it owns. */
export default interface LLMProvider {
    /** Stable identity used to address this LLM Provider. */
    readonly identity: string

    /** Human-readable LLM Provider name. */
    readonly name: string

    /** Returns the LLM Models currently available through this Provider. */
    models(): Promise<readonly LLMModel[]>
}
