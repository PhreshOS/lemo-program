import type { ProgramStore } from "@phreshos/core"
import type LLMProvider from "../../provider"
import type { LLMProviderHandle, LLMProviderRegistration } from "../../provider"
import { llmProviderActiveKey, llmProviderActiveSchema } from "../../provider"
import type {
    LLMMessage,
    LLMModelExecution,
    LLMModelRequest,
    LLMReasoningLevels,
    LLMToolCall
} from "../../model"
import { compatibleReasoning, sameReasoningLevels } from "../../reasoning"
import OpenCodeModel, { type OpenCodeProtocol } from "./model"

const catalog = "https://models.opencode.ai/api.json"
const host = "https://opencode.ai/zen/v1"
const publicKey = "public"
const catalogLifetime = 5 * 60 * 1000

type Request = (input: string | URL | globalThis.Request, init?: RequestInit) => Promise<Response>

/** OpenCode Zen's anonymous, zero-cost LLM Provider. */
export default class OpenCodeProvider implements LLMProvider {

    public static readonly identity = "opencode"

    public readonly identity = OpenCodeProvider.identity
    public readonly name = "OpenCode Zen"

    private readonly retainedModels = new Map<string, Readonly<{
        model: OpenCodeModel
        protocol: OpenCodeProtocol
        contextWindow: number | null
        reasoning: LLMReasoningLevels | null
    }>>()
    private loaded: Readonly<{ expires: number; models: readonly OpenCodeModel[] }> | null = null
    private loading: Promise<readonly OpenCodeModel[]> | null = null

    public constructor(
        public readonly active: boolean,
        private readonly request: Request = globalThis.fetch
    ) {}

    public async models(): Promise<readonly OpenCodeModel[]> {

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

        const response = await this.request(catalog, { headers: { accept: "application/json" } })

        if (!response.ok) throw new Error(await failure(response, "OpenCode could not load its Model catalog"))

        const payload: unknown = await response.json()

        if (!record(payload) || !record(payload.opencode) || !record(payload.opencode.models)) {

            throw new Error("OpenCode returned an invalid Model catalog")
        }

        const models = Object.entries(payload.opencode.models).flatMap(([identity, value]) => {

            const protocol = freeProtocol(value)

            if (!protocol) return []

            const model = modelIdentity(identity)

            return [this.model(model, protocol, modelContextWindow(model, value), modelReasoning(model, value))]
        })

        return Object.freeze(models)
    }

    private model(
        identity: string,
        protocol: OpenCodeProtocol,
        contextWindow: number | null,
        reasoning: LLMReasoningLevels | null
    ) {

        const retained = this.retainedModels.get(identity)

        if (retained?.protocol === protocol && retained.contextWindow === contextWindow
            && sameReasoningLevels(retained.reasoning, reasoning)) return retained.model

        const model = new OpenCodeModel(
            this,
            identity,
            protocol,
            contextWindow,
            reasoning,
            compatibleReasoning(retained?.model.reasoning ?? null, reasoning),
            (request, level, execution) => this.generate(identity, protocol, request, level, execution)
        )

        this.retainedModels.set(identity, Object.freeze({ model, protocol, contextWindow, reasoning }))

        return model
    }

    private generate(
        model: string,
        protocol: OpenCodeProtocol,
        request: LLMModelRequest,
        reasoning: string | null,
        execution?: LLMModelExecution
    ) {

        return protocol === "responses"
            ? this.generateResponses(model, request, reasoning, execution)
            : this.generateChat(model, request, reasoning, execution)
    }

    private async *generateChat(
        model: string,
        request: LLMModelRequest,
        reasoning: string | null,
        execution?: LLMModelExecution
    ) {

        const response = await this.fetch("/chat/completions", {
            method: "POST",
            signal: execution?.signal,
            body: JSON.stringify({
                model,
                messages: request.messages.map(chatMessage),
                ...(request.tools.length && {
                    tools: request.tools.map(tool => ({ type: "function", function: tool }))
                }),
                ...(reasoning !== null && { reasoning_effort: reasoning }),
                stream: true
            })
        })

        if (!response.body) throw new Error("OpenCode returned no generation stream")

        const calls = new Map<number, MutableToolCall>()

        for await (const data of serverSentEvents(response.body)) {

            if (data === "[DONE]") break

            const value = json(data, `OpenCode Model "${model}" returned an invalid generation event`)

            throwEventError(value)

            if (!record(value) || !Array.isArray(value.choices)) continue

            for (const choice of value.choices) {

                if (!record(choice) || !record(choice.delta)) continue

                if (typeof choice.delta.content === "string" && choice.delta.content) {

                    yield { type: "text" as const, content: choice.delta.content }
                }

                if (!Array.isArray(choice.delta.tool_calls)) continue

                for (const part of choice.delta.tool_calls) retainToolCall(calls, part)
            }
        }

        for (const call of calls.values()) yield { type: "tool-call" as const, call: completeToolCall(call, model) }
    }

    private async *generateResponses(
        model: string,
        request: LLMModelRequest,
        reasoning: string | null,
        execution?: LLMModelExecution
    ) {

        const response = await this.fetch("/responses", {
            method: "POST",
            signal: execution?.signal,
            body: JSON.stringify({
                model,
                input: request.messages.flatMap(responseInput),
                ...(request.tools.length && {
                    tools: request.tools.map(tool => ({ type: "function", ...tool }))
                }),
                ...(reasoning !== null && { reasoning: { effort: reasoning } }),
                stream: true
            })
        })

        if (!response.body) throw new Error("OpenCode returned no generation stream")

        for await (const data of serverSentEvents(response.body)) {

            if (data === "[DONE]") break

            const value = json(data, `OpenCode Model "${model}" returned an invalid generation event`)

            throwEventError(value)

            if (!record(value)) continue

            if (value.type === "response.output_text.delta" && typeof value.delta === "string" && value.delta) {

                yield { type: "text" as const, content: value.delta }
            }

            if (value.type === "response.output_item.done" && record(value.item) && value.item.type === "function_call") {

                yield { type: "tool-call" as const, call: responseToolCall(value.item, model) }
            }
        }
    }

    private async fetch(path: string, init: RequestInit) {

        const response = await this.request(`${host}${path}`, {
            ...init,
            headers: {
                authorization: `Bearer ${publicKey}`,
                "content-type": "application/json",
                ...init.headers
            }
        })

        if (!response.ok) throw new Error(await failure(response, "OpenCode request failed"))

        return response
    }
}

class OpenCodeHandle implements LLMProviderHandle {

    public readonly identity = OpenCodeProvider.identity

    private current: OpenCodeProvider

    private constructor(
        private readonly store: ProgramStore,
        private isActive: boolean
    ) {

        this.current = new OpenCodeProvider(isActive)
    }

    public static async open(store: ProgramStore) {

        const stored = await store.get(activeKey)
        const active = stored === undefined ? true : llmProviderActiveSchema.parse(stored)

        if (stored === undefined) await store.set(activeKey, active)

        return new OpenCodeHandle(store, active)
    }

    public get provider() {

        return this.current
    }

    public state() {

        return Object.freeze({ configured: true, active: this.isActive })
    }

    public async configure(): Promise<void> {

        throw new Error("OpenCode Zen does not accept configuration")
    }

    public async removeConfiguration(): Promise<void> {

        throw new Error("OpenCode Zen has no configuration to remove")
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
        this.current = new OpenCodeProvider(active)
    }
}

const activeKey = llmProviderActiveKey(OpenCodeProvider.identity)

export const registration: LLMProviderRegistration = Object.freeze({
    identity: OpenCodeProvider.identity,
    open: OpenCodeHandle.open
})

function freeProtocol(value: unknown): OpenCodeProtocol | null {

    if (!record(value) || value.status === "deprecated" || !record(value.cost) || value.cost.input !== 0) return null

    if (!record(value.provider) || value.provider.npm === undefined) return "chat-completions"

    if (value.provider.npm === "@ai-sdk/openai-compatible") return "chat-completions"

    if (value.provider.npm === "@ai-sdk/openai") return "responses"

    return null
}

function modelContextWindow(model: string, value: unknown): number | null {

    if (!record(value) || !record(value.limit)) {
        throw new Error(`OpenCode returned invalid limits for Model "${model}"`)
    }

    const context = value.limit.context

    if (context === 0) return null

    if (!Number.isSafeInteger(context) || (context as number) < 1) {
        throw new Error(`OpenCode returned an invalid context window for Model "${model}"`)
    }

    return context as number
}

function modelReasoning(model: string, value: unknown): LLMReasoningLevels | null {

    if (!record(value)) throw new Error(`OpenCode returned invalid metadata for Model "${model}"`)

    if (value.reasoning_options === undefined) return null

    if (!Array.isArray(value.reasoning_options)) {
        throw new Error(`OpenCode returned invalid reasoning options for Model "${model}"`)
    }

    const effort = value.reasoning_options.find(option => record(option) && option.type === "effort")

    if (effort === undefined) return null

    if (!record(effort) || !Array.isArray(effort.values)
        || !effort.values.every(level => level === null || typeof level === "string" && level.trim().length > 0)) {

        throw new Error(`OpenCode returned invalid reasoning levels for Model "${model}"`)
    }

    const levels = effort.values.map(level => level ?? "none")

    if (!levels.length) return null

    if (new Set(levels).size !== levels.length) {
        throw new Error(`OpenCode returned duplicate reasoning levels for Model "${model}"`)
    }

    return Object.freeze({
        levels: Object.freeze(levels),
        default: null,
        required: !levels.includes("none")
    })
}

function chatMessage(message: LLMMessage) {

    if (message.role === "assistant" && message.toolCalls?.length) {

        return {
            role: message.role,
            content: message.content || null,
            tool_calls: message.toolCalls.map(call => ({
                id: call.id,
                type: "function",
                function: { name: call.name, arguments: JSON.stringify(call.input ?? {}) }
            }))
        }
    }

    if (message.role === "tool") {

        return { role: message.role, tool_call_id: message.call, content: message.content }
    }

    return { role: message.role, content: message.content }
}

function responseInput(message: LLMMessage): readonly Record<string, unknown>[] {

    if (message.role === "assistant" && message.toolCalls?.length) {

        return Object.freeze([
            ...(message.content ? [{ role: message.role, content: message.content }] : []),
            ...message.toolCalls.map(call => ({
                type: "function_call",
                call_id: call.id,
                name: call.name,
                arguments: JSON.stringify(call.input ?? {})
            }))
        ])
    }

    if (message.role === "tool") {

        return Object.freeze([{ type: "function_call_output", call_id: message.call, output: message.content }])
    }

    return Object.freeze([{ role: message.role, content: message.content }])
}

function retainToolCall(calls: Map<number, MutableToolCall>, value: unknown) {

    if (!record(value)) return

    const index = typeof value.index === "number" ? value.index : calls.size

    const call = calls.get(index) ?? { id: "", name: "", arguments: "" }

    if (typeof value.id === "string") call.id = value.id

    if (record(value.function)) {

        if (typeof value.function.name === "string") call.name += value.function.name

        if (typeof value.function.arguments === "string") call.arguments += value.function.arguments
    }

    calls.set(index, call)
}

function completeToolCall(value: MutableToolCall, model: string): LLMToolCall {

    if (!value.name.trim()) throw new Error(`OpenCode Model "${model}" returned a Tool call without a name`)

    return Object.freeze({
        id: value.id || crypto.randomUUID(),
        name: value.name,
        input: json(value.arguments || "{}", `OpenCode Model "${model}" returned invalid Tool input`)
    })
}

function responseToolCall(value: Record<string, unknown>, model: string): LLMToolCall {

    const name = typeof value.name === "string" ? value.name.trim() : ""

    if (!name) throw new Error(`OpenCode Model "${model}" returned a Tool call without a name`)

    return Object.freeze({
        id: typeof value.call_id === "string" && value.call_id ? value.call_id : crypto.randomUUID(),
        name,
        input: json(
            typeof value.arguments === "string" ? value.arguments : "{}",
            `OpenCode Model "${model}" returned invalid Tool input`
        )
    })
}

async function *serverSentEvents(stream: ReadableStream<Uint8Array>) {

    let data: string[] = []

    for await (const line of lines(stream)) {

        if (line === "") {

            if (data.length) yield data.join("\n")

            data = []

            continue
        }

        if (line.startsWith("data:")) data.push(line.slice(5).trimStart())
    }

    if (data.length) yield data.join("\n")
}

async function *lines(stream: ReadableStream<Uint8Array>) {

    const reader = stream.getReader()
    const decoder = new TextDecoder()

    let buffered = ""

    try {
        while (true) {

            const { done, value } = await reader.read()

            if (done) break

            buffered += decoder.decode(value, { stream: true })

            const complete = buffered.split("\n")

            buffered = complete.pop() ?? ""

            for (const line of complete) yield line.endsWith("\r") ? line.slice(0, -1) : line
        }

        buffered += decoder.decode()

        if (buffered) yield buffered.endsWith("\r") ? buffered.slice(0, -1) : buffered
    } finally {
        reader.releaseLock()
    }
}

async function failure(response: Response, fallback: string) {

    const body = await response.text()

    try {
        const value: unknown = JSON.parse(body)

        if (record(value)) {

            if (typeof value.error === "string") return value.error

            if (record(value.error) && typeof value.error.message === "string") return value.error.message

            if (typeof value.message === "string") return value.message
        }
    } catch {}

    return body.trim() || `${fallback} with status ${response.status}`
}

function throwEventError(value: unknown): void {

    if (!record(value)) return

    if (typeof value.error === "string") throw new Error(value.error)

    if (record(value.error) && typeof value.error.message === "string") throw new Error(value.error.message)

    if (value.type === "error" && typeof value.message === "string") throw new Error(value.message)
}

function json(value: string, error: string): unknown {

    try {
        return JSON.parse(value)
    } catch {
        throw new Error(error)
    }
}

function modelIdentity(value: string) {

    const identity = value.trim()

    if (!identity) throw new Error("OpenCode returned a Model without an identity")

    return identity
}

function record(value: unknown): value is Record<string, unknown> {

    return typeof value === "object" && value !== null && !Array.isArray(value)
}

type MutableToolCall = {
    id: string
    name: string
    arguments: string
}
