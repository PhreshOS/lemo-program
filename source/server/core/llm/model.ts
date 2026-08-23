import type LLMProvider from "./provider"

/** One executable language model owned by an LLM Provider. */
export default interface LLMModel {
    /** Provider-local model identity. */
    readonly id: string

    /** LLM Provider that owns and supports this Model. */
    readonly provider: LLMProvider

    /** Generates text chunks through this Model. */
    generate(input: string): AsyncGenerator<string, void, unknown>
}

/** State from which Client Core reconstructs one LLM Model. */
export type LLMModelRecord = Readonly<{
    provider: string
    id: string
}>

/** Requests streamed generation from one initialized LLM Model. */
export type LLMGenerationRequest = Readonly<{
    generation: string
    provider: string
    model: string
    input: string
}>

/** One streamed generation fact published by Server Core. */
export type LLMGenerationEvent = Readonly<{
    type: "chunk"
    chunk: string
}> | Readonly<{
    type: "complete"
}>
