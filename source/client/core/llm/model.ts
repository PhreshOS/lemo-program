import type LLMProvider from "./provider"

/** One local handle to an authoritative LLM Model. */
export default interface LLMModel {
    readonly id: string
    readonly provider: LLMProvider

    generate(input: string): AsyncGenerator<string, void, unknown>
}
