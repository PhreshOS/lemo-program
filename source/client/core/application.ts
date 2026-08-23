import { current } from "@phreshos/client"
import type {
    LLMGenerationEvent,
    LLMGenerationRequest,
    LLMModelRecord
} from "@server/core/llm/model"
import type {
    OllamaCloudConfiguration,
    OllamaCloudConfigurationState
} from "@server/core/llm/providers/ollama-cloud/configuration"
import LLMProviders from "./llm/providers"

const generationTimeout = 5 * 60 * 1000

export default class Application {

    public readonly llmProviders = new LLMProviders(serverSource)

    public async name(): Promise<string> {

        return await current.server.ask<string>("application.name")
    }
}

const serverSource = {
    async configuration() {

        return await current.server.ask<OllamaCloudConfigurationState>("llm-provider.ollama-cloud.configuration")
    },
    async configure(configuration: OllamaCloudConfiguration) {

        await current.server.ask("llm-provider.ollama-cloud.configure", configuration)
    },
    async removeConfiguration() {

        await current.server.ask("llm-provider.ollama-cloud.remove-configuration")
    },
    async activate() {

        await current.server.ask("llm-provider.ollama-cloud.activate")
    },
    async deactivate() {

        await current.server.ask("llm-provider.ollama-cloud.deactivate")
    },
    async models() {

        return await current.server.ask<readonly LLMModelRecord[]>("llm-models")
    },
    async *generate(provider: string, model: string, request: LLMGenerationRequest["request"]) {

        yield* stream(
            "llm-generate",
            generation => ({ generation, provider, model, request } satisfies LLMGenerationRequest)
        )
    }
}

async function *stream<Request>(operation: string, request: (generation: string) => Request) {

    const generation = crypto.randomUUID()

    const controller = new AbortController()

    const events = current.server.events<unknown>(generation, {
        capacity: Infinity,
        signal: controller.signal
    })

    const iterator = events[Symbol.asyncIterator]()

    let next = iterator.next()

    let failure: unknown

    const completion = current.server.timeout(generationTimeout).ask<void>(operation, request(generation)).catch(error => {

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
