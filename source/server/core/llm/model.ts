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

    /** Generates structured events and returns authoritative usage when available. */
    generate(request: LLMModelRequest, execution?: LLMModelExecution): AsyncGenerator<LLMModelEvent, LLMModelUsage | null, unknown>
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

/** Provider-reported token usage for one complete Model generation. */
export type LLMModelUsage = Readonly<{
    input: Readonly<{
        tokens: number
        cachedTokens?: number
    }>
    output: Readonly<{
        tokens: number
        reasoningTokens?: number
    }>
}>

/** Validates and freezes one provider-neutral Model usage value. */
export function modelUsage(value: unknown): LLMModelUsage {

    const usage = record(value)
    const input = record(usage?.input)
    const output = record(usage?.output)

    if (!usage || !input || !output) throw new Error("Invalid LLM Model usage")

    const inputTokens = tokenCount(input.tokens)
    const outputTokens = tokenCount(output.tokens)
    const cachedTokens = optionalTokenCount(input.cachedTokens)
    const reasoningTokens = optionalTokenCount(output.reasoningTokens)

    if (cachedTokens !== undefined && cachedTokens > inputTokens) {
        throw new Error("Cached LLM input tokens exceed total input tokens")
    }

    if (reasoningTokens !== undefined && reasoningTokens > outputTokens) {
        throw new Error("Reasoning LLM output tokens exceed total output tokens")
    }

    return Object.freeze({
        input: Object.freeze({
            tokens: inputTokens,
            ...(cachedTokens !== undefined && { cachedTokens })
        }),
        output: Object.freeze({
            tokens: outputTokens,
            ...(reasoningTokens !== undefined && { reasoningTokens })
        })
    })
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
    usage: LLMModelUsage | null
}>

function tokenCount(value: unknown) {

    if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error("Invalid LLM token count")

    return value as number
}

function optionalTokenCount(value: unknown) {

    return value === undefined || value === null ? undefined : tokenCount(value)
}

function record(value: unknown): Record<string, unknown> | null {

    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null
}
