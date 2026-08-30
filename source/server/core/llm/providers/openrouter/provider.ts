import { OpenRouter } from "@openrouter/sdk"
import type { ChatMessages, ChatStreamChunk, ChatStreamToolCall, Model } from "@openrouter/sdk/models"
import type { ProgramStore } from "@phreshos/core"
import type LLMProvider from "../../provider"
import type { LLMProviderHandle, LLMProviderRegistration } from "../../provider"
import { llmProviderActiveKey, llmProviderActiveSchema } from "../../provider"
import type { LLMMessage, LLMModelExecution, LLMModelRequest, LLMReasoning, LLMToolCall } from "../../model"
import openRouterConfiguration from "./configuration"
import type { OpenRouterConfiguration } from "./configuration"
import OpenRouterModel from "./model"

const catalogLifetime = 5 * 60 * 1_000
const maximumModels = 1_000
const gatewayReasoningLevels = Object.freeze(["max", "xhigh", "high", "medium", "low", "minimal", "none"])

/** OpenRouter's official SDK-backed LLM Provider. */
export default class OpenRouterProvider implements LLMProvider {

    public static readonly identity = "openrouter"

    public readonly identity = OpenRouterProvider.identity
    public readonly name = "OpenRouter"

    private readonly retainedModels = new Map<string, Readonly<{
        model: OpenRouterModel
        reasoning: LLMReasoning | null
    }>>()
    private loaded: Readonly<{ expires: number; models: readonly OpenRouterModel[] }> | null = null
    private loading: Promise<readonly OpenRouterModel[]> | null = null

    public constructor(
        configuration: OpenRouterConfiguration,
        public readonly active: boolean,
        private readonly client = new OpenRouter({
            apiKey: configuration.apiKey,
            httpReferer: "https://phreshos.com",
            appTitle: "Lemo",
            appCategories: "cloud-agent"
        })
    ) {}

    public async models(): Promise<readonly OpenRouterModel[]> {

        if (this.loaded && this.loaded.expires > Date.now()) return this.loaded.models

        if (this.loading) return this.loading

        this.loading = this.loadModels()

        try {
            const models = await this.loading

            this.loaded = Object.freeze({ expires: Date.now() + catalogLifetime, models })

            return models
        } finally {
            this.loading = null
        }
    }

    private async loadModels() {

        const page = await this.client.models.list({
            limit: maximumModels,
            outputModalities: "text",
            supportedParameters: "tools"
        })

        if (page.result.links.next !== null || page.result.totalCount > maximumModels) {
            throw new Error(`OpenRouter's Model catalog exceeds the ${maximumModels}-Model safety bound`)
        }

        return Object.freeze(page.result.data.map(value => {

            const identity = modelIdentity(value.id)

            return this.model(identity, modelReasoning(identity, value))
        }))
    }

    private model(identity: string, reasoning: LLMReasoning | null) {

        const retained = this.retainedModels.get(identity)

        if (retained && sameReasoning(retained.reasoning, reasoning)) return retained.model

        const model = new OpenRouterModel(this, identity, reasoning, (request, execution) => (
            this.generate(identity, request, execution)
        ))

        this.retainedModels.set(identity, Object.freeze({ model, reasoning }))

        return model
    }

    private async *generate(model: string, request: LLMModelRequest, execution?: LLMModelExecution) {

        const response = await this.client.chat.send({
            chatRequest: {
                model,
                messages: request.messages.map(openRouterMessage),
                provider: { requireParameters: true },
                stream: true,
                ...(request.tools.length && {
                    tools: request.tools.map(tool => ({
                        type: "function" as const,
                        function: {
                            name: tool.name,
                            description: tool.description,
                            parameters: tool.parameters
                        }
                    }))
                })
            }
        }, { signal: execution?.signal })

        if (!isStream(response)) throw new Error(`OpenRouter Model "${model}" returned no generation stream`)

        const calls = new Map<number, MutableToolCall>()

        for await (const chunk of response) {
            if (chunk.error) throw new Error(chunk.error.message)

            for (const choice of chunk.choices) {
                if (choice.delta.content) yield { type: "text" as const, content: choice.delta.content }

                for (const part of choice.delta.toolCalls ?? []) retainToolCall(calls, part)
            }
        }

        for (const call of calls.values()) yield { type: "tool-call" as const, call: completeToolCall(call, model) }
    }
}

class OpenRouterHandle implements LLMProviderHandle {

    public readonly identity = OpenRouterProvider.identity

    private configuration: OpenRouterConfiguration | null
    private isActive: boolean
    private current: OpenRouterProvider | null

    private constructor(
        private readonly store: ProgramStore,
        configuration: OpenRouterConfiguration | null,
        active: boolean
    ) {

        this.configuration = configuration
        this.isActive = active
        this.current = configuration ? new OpenRouterProvider(configuration, active) : null
    }

    public static async open(store: ProgramStore) {

        const value = await store.get(configurationKey)
        const configuration = value === undefined ? null : openRouterConfiguration(value)
        const storedActive = await store.get(activeKey)
        const active = storedActive === undefined ? true : llmProviderActiveSchema.parse(storedActive)

        if (storedActive === undefined) await store.set(activeKey, active)

        return new OpenRouterHandle(store, configuration, active)
    }

    public get provider() {

        return this.current
    }

    public state() {

        return Object.freeze({ configured: this.configuration !== null, active: this.isActive })
    }

    public async configure(value: unknown): Promise<void> {

        const configuration = openRouterConfiguration(value)

        await this.store.set(configurationKey, configuration)

        this.configuration = configuration
        this.current = new OpenRouterProvider(configuration, this.isActive)
    }

    public async removeConfiguration(): Promise<void> {

        await this.store.delete(configurationKey)

        this.configuration = null
        this.current = null
    }

    public async activate(): Promise<void> {

        await this.setActive(true)
    }

    public async deactivate(): Promise<void> {

        await this.setActive(false)
    }

    private async setActive(active: boolean) {

        await this.store.set(activeKey, active)

        this.isActive = active
        this.current = this.configuration ? new OpenRouterProvider(this.configuration, active) : null
    }
}

const configurationKey = `${OpenRouterProvider.identity}:config`
const activeKey = llmProviderActiveKey(OpenRouterProvider.identity)

export const registration: LLMProviderRegistration = Object.freeze({
    identity: OpenRouterProvider.identity,
    open: OpenRouterHandle.open
})

function openRouterMessage(message: LLMMessage): ChatMessages {

    if (message.role === "assistant") {
        return {
            role: message.role,
            content: message.content,
            ...(message.toolCalls?.length && {
                toolCalls: message.toolCalls.map(call => ({
                    id: call.id,
                    type: "function" as const,
                    function: { name: call.name, arguments: JSON.stringify(call.input) }
                }))
            })
        }
    }

    if (message.role === "tool") {
        return { role: message.role, toolCallId: message.call, content: message.content }
    }

    return { role: message.role, content: message.content }
}

function retainToolCall(calls: Map<number, MutableToolCall>, value: ChatStreamToolCall) {

    const call = calls.get(value.index) ?? { id: "", name: "", arguments: "" }

    if (value.id) call.id = value.id
    if (value.function?.name) call.name += value.function.name
    if (value.function?.arguments) call.arguments += value.function.arguments

    calls.set(value.index, call)
}

function completeToolCall(value: MutableToolCall, model: string): LLMToolCall {

    if (!value.name.trim()) throw new Error(`OpenRouter Model "${model}" returned a Tool call without a name`)

    return Object.freeze({
        id: value.id || crypto.randomUUID(),
        name: value.name,
        input: json(value.arguments || "{}", `OpenRouter Model "${model}" returned invalid Tool input`)
    })
}

function json(value: string, error: string) {

    try {
        return JSON.parse(value) as unknown
    } catch {
        throw new Error(error)
    }
}

function modelIdentity(value: string) {

    const identity = value.trim()

    if (!identity) throw new Error("OpenRouter returned a Model without an identity")

    return identity
}

function modelReasoning(model: string, value: Model): LLMReasoning | null {

    const reasoning = value.reasoning
    if (!reasoning || reasoning.supportedEfforts === undefined) return null

    const efforts = reasoning.supportedEfforts === null
        ? gatewayReasoningLevels
        : reasoning.supportedEfforts

    if (!efforts.every(level => level === null || level.trim().length > 0)) {
        throw new Error(`OpenRouter returned invalid reasoning levels for Model "${model}"`)
    }

    const levels = efforts
        .filter((level): level is string => level !== null && (!reasoning.mandatory || level !== "none"))
        .toReversed()

    if (!levels.length) return null

    if (new Set(levels).size !== levels.length) {
        throw new Error(`OpenRouter returned duplicate reasoning levels for Model "${model}"`)
    }

    const defaultLevel = reasoning.defaultEffort ?? null

    if (defaultLevel !== null && !levels.includes(defaultLevel)) {
        throw new Error(`OpenRouter returned a reasoning default outside the levels for Model "${model}"`)
    }

    return Object.freeze({
        levels: Object.freeze(levels),
        default: defaultLevel,
        required: reasoning.mandatory
    })
}

function sameReasoning(left: LLMReasoning | null, right: LLMReasoning | null) {

    if (left === null || right === null) return left === right

    return left.default === right.default
        && left.required === right.required
        && left.levels.length === right.levels.length
        && left.levels.every((level, index) => level === right.levels[index])
}

function isStream(value: unknown): value is AsyncIterable<ChatStreamChunk> {

    return typeof value === "object" && value !== null && Symbol.asyncIterator in value
}

type MutableToolCall = {
    id: string
    name: string
    arguments: string
}
