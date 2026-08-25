import type { Server } from "@phreshos/client"
import type {
    LLMGenerationEvent,
    LLMGenerationRequest,
    LLMModelRecord
} from "@server/core/llm/model"
import type { LLMProviderState } from "@server/core/llm/provider"
import type { LLMModelSource } from "./model"
import type { LLMProviderSource } from "./provider"

const generationTimeout = 5 * 60 * 1000
const eventQueueCapacity = 256

/** Adapts one concrete Server handle to Client Core's generic LLM contracts. */
export function llmServerSources(server: Server): Readonly<{
    models: LLMModelSource
    providers: LLMProviderSource
}> {

    return Object.freeze({
        providers: {
            state: provider => server.ask<LLMProviderState>("llm-provider.state", { provider }),
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
        },
        models: {
            models: () => server.ask<readonly LLMModelRecord[]>("llm-models"),
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
