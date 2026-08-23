import type LLMModel from "./model"

/** One local handle to an authoritative LLM Provider. */
export default interface LLMProvider {
    readonly identity: string
    readonly name: string

    configured(): Promise<boolean>
    active(): Promise<boolean>
    activate(): Promise<void>
    deactivate(): Promise<void>
    models(): Promise<readonly LLMModel[]>
}
