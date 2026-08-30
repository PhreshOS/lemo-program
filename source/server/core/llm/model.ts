import type LLMProvider from "./provider"

/** One executable language model owned by an LLM Provider. */
export default interface LLMModel {
    /** Provider-local model identity. */
    readonly id: string

    /** LLM Provider that owns and supports this Model. */
    readonly provider: LLMProvider

    /** Currently selected reasoning override, or `null` for Provider defaults. */
    readonly reasoning: string | null

    /** Returns this Model's maximum context window in tokens, or `null` when unknown. */
    contextWindow(): Promise<number | null>

    /** Returns this Model's selectable reasoning levels, or `null` when it exposes none. */
    reasoningLevels(): Promise<LLMReasoningLevels | null>

    /** Selects one exposed reasoning level, or clears the override with `null`. */
    setReasoning(level: string | null): Promise<void>

    /** Generates structured events from one complete, ordered Model request. */
    generate(request: LLMModelRequest, execution?: LLMModelExecution): AsyncGenerator<LLMModelEvent, void, unknown>
}

/** Provider-authored selectable reasoning levels for one exact Model. */
export type LLMReasoningLevels = Readonly<{
    /** Exact accepted values, ordered from weakest to strongest. */
    levels: readonly string[]

    /** Provider default when it is known. */
    default: string | null

    /** Whether this Model rejects disabling reasoning. */
    required: boolean
}>

export type LLMModelExecution = Readonly<{
    signal: AbortSignal
}>

export type LLMMessage = Readonly<{
    role: "system" | "user"
    content: string
}> | Readonly<{
    role: "assistant"
    content: string
    toolCalls?: readonly LLMToolCall[]
}> | Readonly<{
    role: "tool"
    call: string
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
    reasoning: string | null
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
