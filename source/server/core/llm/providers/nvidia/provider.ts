import OpenAI from "openai"
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions"
import type { ProgramStore } from "@phreshos/core"
import type { LLMMessage, LLMModelExecution, LLMModelRequest, LLMModelUsage } from "../../model"
import { modelUsage } from "../../model"
import type LLMProvider from "../../provider"
import type { LLMProviderHandle, LLMProviderRegistration } from "../../provider"
import { llmProviderActiveKey, llmProviderActiveSchema } from "../../provider"
import { compatibleReasoning, sameReasoningLevels } from "../../reasoning"
import nvidiaConfiguration, { type NvidiaConfiguration } from "./configuration"
import { nvidiaCatalog, reasoningEffort, type NvidiaModelMetadata } from "./catalog"
import NvidiaModel from "./model"

const host = "https://integrate.api.nvidia.com/v1"
const catalogLifetime = 5 * 60 * 1_000

/** NVIDIA-hosted Models using its OpenAI-compatible API. */
export default class NvidiaProvider implements LLMProvider {

    public static readonly identity = "nvidia"

    public readonly identity = NvidiaProvider.identity
    public readonly name = "NVIDIA"

    private readonly client: OpenAI
    private readonly retainedModels = new Map<string, { model: NvidiaModel, metadata: NvidiaModelMetadata }>()
    private loaded: { expires: number, models: readonly NvidiaModel[] } | null = null
    private loading: Promise<readonly NvidiaModel[]> | null = null

    public constructor(
        configuration: NvidiaConfiguration,
        public readonly active: boolean,
        private readonly request: typeof globalThis.fetch = globalThis.fetch
    ) {

        this.client = new OpenAI({ apiKey: configuration.apiKey, baseURL: host, fetch: request, maxRetries: 0, timeout: 120_000 })
    }

    public async models(): Promise<readonly NvidiaModel[]> {

        if (this.loaded && this.loaded.expires > Date.now()) return this.loaded.models

        if (this.loading) return this.loading

        this.loading = this.loadModels()

        try {
            const models = await this.loading

            this.loaded = { expires: Date.now() + catalogLifetime, models }

            return models
        } finally {
            this.loading = null
        }
    }

    private async loadModels() {

        const [available, catalog] = await Promise.all([this.client.models.list(), nvidiaCatalog(this.request)])

        const models: NvidiaModel[] = []

        for (const entry of available.data) {

            const metadata = catalog.get(entry.id)

            if (!metadata) continue

            const retained = this.retainedModels.get(entry.id)

            if (retained && retained.metadata.contextWindow === metadata.contextWindow
                && sameReasoningLevels(retained.metadata.reasoning, metadata.reasoning)) {

                models.push(retained.model)

                continue
            }

            const model = new NvidiaModel(this, entry.id, metadata.contextWindow, metadata.reasoning,
                compatibleReasoning(retained?.model.reasoning ?? null, metadata.reasoning),
                (request, reasoning, execution) => this.generate(entry.id, request, reasoning, execution))

            this.retainedModels.set(entry.id, { model, metadata })

            models.push(model)
        }

        return Object.freeze(models)
    }

    private async *generate(model: string, request: LLMModelRequest, reasoning: string | null, execution?: LLMModelExecution) {

        const stream = await this.client.chat.completions.create({
            model,
            messages: request.messages.map(nvidiaMessage),
            ...(request.tools.length && { tools: request.tools.map(tool => ({ type: "function" as const, function: tool })) }),
            ...(reasoning !== null && { reasoning_effort: reasoningEffort.parse(reasoning) }),
            stream: true,
            stream_options: { include_usage: true }
        }, { signal: execution?.signal })

        const calls = new Map<number, { id: string, name: string, arguments: string }>()
        let usage: LLMModelUsage | null = null
        let finished = false

        for await (const chunk of stream) {

            if (chunk.usage) usage = modelUsage({
                input: { tokens: chunk.usage.prompt_tokens, cachedTokens: chunk.usage.prompt_tokens_details?.cached_tokens },
                output: { tokens: chunk.usage.completion_tokens, reasoningTokens: chunk.usage.completion_tokens_details?.reasoning_tokens }
            })

            for (const choice of chunk.choices) {

                if (choice.index !== 0) continue

                if (choice.delta.refusal) throw new Error(choice.delta.refusal)

                if (choice.delta.content) yield { type: "text" as const, content: choice.delta.content }

                for (const part of choice.delta.tool_calls ?? []) {

                    const call = calls.get(part.index) ?? { id: "", name: "", arguments: "" }

                    if (part.id) call.id = part.id

                    if (part.function?.name) call.name += part.function.name

                    if (part.function?.arguments) call.arguments += part.function.arguments

                    calls.set(part.index, call)
                }

                if (choice.finish_reason !== null) {

                    if (choice.finish_reason !== "stop" && choice.finish_reason !== "tool_calls") {
                        throw new Error(`NVIDIA Model "${model}" ended generation with ${choice.finish_reason}`)
                    }

                    finished = true
                }
            }
        }

        execution?.signal.throwIfAborted()

        if (!finished) throw new Error(`NVIDIA Model "${model}" returned an incomplete generation stream`)

        for (const call of calls.values()) {

            if (!call.id || !call.name || !call.arguments) throw new Error(`NVIDIA Model "${model}" returned an incomplete Tool call`)

            const input: unknown = JSON.parse(call.arguments)

            yield { type: "tool-call" as const, call: { id: call.id, name: call.name, input } }
        }

        return usage
    }
}

class NvidiaHandle implements LLMProviderHandle {

    public readonly identity = NvidiaProvider.identity

    private current: NvidiaProvider | null

    private constructor(private readonly store: ProgramStore, private configuration: NvidiaConfiguration | null, private isActive: boolean) {

        this.current = configuration ? new NvidiaProvider(configuration, isActive) : null
    }

    public static async open(store: ProgramStore) {

        const value = await store.get(configurationKey)
        const configuration = value === undefined ? null : nvidiaConfiguration(value)
        const storedActive = await store.get(activeKey)
        const active = storedActive === undefined ? true : llmProviderActiveSchema.parse(storedActive)

        if (storedActive === undefined) await store.set(activeKey, active)

        return new NvidiaHandle(store, configuration, active)
    }

    public get provider() {

        return this.current
    }

    public state() {

        return Object.freeze({ configured: this.configuration !== null, active: this.isActive })
    }

    public async configure(value: unknown): Promise<void> {

        const configuration = nvidiaConfiguration(value)

        await this.store.set(configurationKey, configuration)

        this.configuration = configuration
        this.current = new NvidiaProvider(configuration, this.isActive)
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
        this.current = this.configuration ? new NvidiaProvider(this.configuration, active) : null
    }
}

const configurationKey = `${NvidiaProvider.identity}:config`
const activeKey = llmProviderActiveKey(NvidiaProvider.identity)

export const registration: LLMProviderRegistration = Object.freeze({ identity: NvidiaProvider.identity, open: NvidiaHandle.open })

function nvidiaMessage(message: LLMMessage): ChatCompletionMessageParam {

    if (message.role === "assistant") return {
        role: "assistant",
        content: message.content || null,
        ...(message.toolCalls?.length && { tool_calls: message.toolCalls.map(call => ({
            id: call.id,
            type: "function" as const,
            function: { name: call.name, arguments: JSON.stringify(call.input) }
        })) })
    }

    if (message.role === "tool") return { role: "tool", tool_call_id: message.call, content: message.content }

    return { role: message.role, content: message.content }
}
