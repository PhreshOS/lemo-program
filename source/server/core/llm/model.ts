import type LLMProvider from "./provider"

/** One executable language model owned by an LLM Provider. */
export default interface LLMModel {
    /** Provider-local model identity. */
    readonly id: string

    /** LLM Provider that owns and supports this Model. */
    readonly provider: LLMProvider

    /** Generates structured events from one complete, ordered Model request. */
    generate(request: LLMModelRequest): AsyncGenerator<LLMModelEvent, void, unknown>
}

export type LLMMessage = Readonly<{
    role: "system" | "user"
    content: string
}> | Readonly<{
    role: "assistant"
    content: string
    toolCalls?: readonly LLMToolCall[]
}> | Readonly<{
    role: "tool"
    name: string
    content: string
}>

export type LLMModelRequest = Readonly<{
    messages: readonly LLMMessage[]
    tools: readonly LLMToolDefinition[]
}>

export type LLMToolDefinition = Readonly<{
    name: string
    description: string
    parameters: Readonly<Record<string, unknown>>
}>

export type LLMToolCall = Readonly<{
    id: string
    name: string
    input: unknown
}>

export type LLMModelEvent = Readonly<{
    type: "text"
    content: string
}> | Readonly<{
    type: "tool-call"
    call: LLMToolCall
}>

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
    request: LLMModelRequest
}>

/** One streamed generation fact published by Server Core. */
export type LLMGenerationEvent = LLMModelEvent | Readonly<{
    type: "complete"
}>
