import type { Server } from "@phreshos/client"
import type {
    LLMGenerationEvent,
    LLMGenerationRequest,
    LLMModelRecord,
    LLMReasoning
} from "@server/core/llm/model"
import type { LLMProviderState } from "@server/core/llm/provider"
import type { LLMModelSource } from "./model"
import type { LLMProviderSource } from "./provider"
import serverEvents from "../server-events"

const generationTimeout = 5 * 60 * 1000
const eventQueueCapacity = 256

/** Adapts one concrete Server handle to Client Core's generic LLM contracts. */
export function llmServerSources(server: Server): Readonly<{
    models: LLMModelSource
    providers: LLMProviderSource
}> {

    return Object.freeze({
        providers: providerSource(server),
        models: {
            models: () => server.ask<readonly LLMModelRecord[]>("llm-models"),
            reasoning: async (provider, model) => reasoning(await server.ask<unknown>(
                "llm-model.reasoning",
                { provider, model }
            )),
            async *generate(provider, model, request) {

                yield* stream(
                    server,
                    "llm-generate",
                    generation => ({ generation, provider, model, request } satisfies LLMGenerationRequest)
                )
            }
        }
    })
}

function reasoning(value: unknown): LLMReasoning | null {

    if (value === null) return null

    if (!record(value) || !Array.isArray(value.levels) || value.levels.length === 0
        || !value.levels.every(level => typeof level === "string" && level.trim().length > 0)
        || new Set(value.levels).size !== value.levels.length
        || value.default !== null && typeof value.default !== "string"
        || typeof value.required !== "boolean") {

        throw new Error("The Server returned invalid LLM reasoning levels")
    }

    if (value.default !== null && !value.levels.includes(value.default)) {
        throw new Error("The Server returned an LLM reasoning default outside its levels")
    }

    return Object.freeze({
        levels: Object.freeze([...value.levels]) as readonly string[],
        default: value.default,
        required: value.required
    })
}

function providerSource(server: Server): LLMProviderSource {

    const states = new Map<string, LLMProviderState>()
    const subscribers = new Set<() => void>()
    let channel: ReturnType<typeof serverEvents> | null = null
    let initialization: Promise<void> | null = null
    let failure: unknown

    const source: LLMProviderSource = {
        open(providers) {

            if (!initialization) {
                failure = undefined
                initialization = initialize(providers)
            }

            return initialization
        },
        close() {

            channel?.close()
            channel = null
            initialization = null
            states.clear()
            failure = undefined
        },
        subscribe(subscriber) {

            subscribers.add(subscriber)

            return () => { subscribers.delete(subscriber) }
        },
        async state(provider) {

            if (failure !== undefined) throw failure
            if (!initialization) throw new Error("The LLM Provider projection is not open")

            await initialization

            if (failure !== undefined) throw failure

            const state = states.get(provider)

            if (!state) throw new Error(`Unknown LLM Provider "${provider}"`)

            return state
        },
        configure: async (provider, configuration) => {

            await server.ask("llm-provider.configure", { provider, configuration })
        },
        removeConfiguration: async provider => {

            await server.ask("llm-provider.remove-configuration", { provider })
        },
        activate: async provider => {

            await server.ask("llm-provider.activate", { provider })
        },
        deactivate: async provider => {

            await server.ask("llm-provider.deactivate", { provider })
        }
    }

    return Object.freeze(source)

    async function initialize(providers: readonly string[]) {

        const observation = serverEvents(server, "llm-provider.changed")

        channel = observation

        try {
            const snapshots = await Promise.all(providers.map(async provider => Object.freeze({
                provider,
                state: providerState(await server.ask<unknown>("llm-provider.state", { provider }))
            })))

            for (const snapshot of snapshots) states.set(snapshot.provider, snapshot.state)

            if (channel !== observation) {
                observation.close()

                throw new Error("The LLM Provider projection closed while it was opening")
            }

            void follow(observation)
        } catch (cause) {
            observation.close()

            if (channel === observation) {
                channel = null
                initialization = null
            }

            throw cause
        }
    }

    async function follow(observation: NonNullable<typeof channel>) {

        try {
            for await (const value of observation.events) {

                const event = providerEvent(value)

                states.set(event.provider, event.state)

                for (const subscriber of subscribers) subscriber()
            }
        } catch (cause) {
            failure = cause

            for (const subscriber of subscribers) subscriber()
        } finally {
            if (channel === observation) {
                if (failure === undefined) {
                    failure = new Error("The LLM Provider state stream closed")

                    for (const subscriber of subscribers) subscriber()
                }

                channel = null
                initialization = null
            }

            observation.close()
        }
    }
}

function providerEvent(value: unknown) {

    if (!record(value) || value.type !== "llm-provider.changed" || typeof value.provider !== "string") {
        throw new Error("The Server published an invalid LLM Provider state")
    }

    return Object.freeze({ provider: value.provider, state: providerState(value.state) })
}

function providerState(value: unknown): LLMProviderState {

    if (!record(value) || typeof value.configured !== "boolean" || typeof value.active !== "boolean") {
        throw new Error("The Server returned an invalid LLM Provider state")
    }

    return Object.freeze({ configured: value.configured, active: value.active })
}

async function *stream<Request>(server: Server, operation: string, request: (generation: string) => Request) {

    const generation = crypto.randomUUID()
    const controller = new AbortController()
    const events = server.events<unknown>(generation, {
        capacity: eventQueueCapacity,
        signal: controller.signal
    })
    const iterator = events[Symbol.asyncIterator]()

    let next = iterator.next()
    let failure: unknown

    const completion = server.timeout(generationTimeout).ask<void>(operation, request(generation)).catch(error => {

        failure = error
        controller.abort()
    })

    try {
        while (true) {

            const result = await next

            if (result.done) {

                await completion

                if (failure) throw failure

                throw new Error("LLM generation stopped before completing")
            }

            next = iterator.next()

            const event = generationEvent(result.value)

            if (event.type !== "complete") yield event
            else {

                await completion

                if (failure) throw failure

                return
            }
        }
    } finally {
        controller.abort()

        await iterator.return?.()
    }
}

function generationEvent(value: unknown): LLMGenerationEvent {

    if (!record(value) || (value.type !== "text" && value.type !== "tool-call" && value.type !== "complete")) {

        throw new Error("Server returned an invalid LLM generation event")
    }

    if (value.type === "text") {

        if (typeof value.content !== "string") throw new Error("Server returned invalid LLM text")

        return { type: "text", content: value.content }
    }

    if (value.type === "tool-call") {

        if (!record(value.call)) throw new Error("Server returned an invalid LLM tool call")

        const id = typeof value.call.id === "string" ? value.call.id : ""
        const name = typeof value.call.name === "string" ? value.call.name : ""

        if (!id || !name) throw new Error("Server returned an invalid LLM tool call")

        return { type: "tool-call", call: { id, name, input: value.call.input } }
    }

    return { type: "complete" }
}

function record(value: unknown): value is Record<string, unknown> {

    return typeof value === "object" && value !== null && !Array.isArray(value)
}
