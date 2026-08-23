import { current } from "@phreshos/server"
import Application from "@server/core/application"
import type {
    LLMGenerationEvent,
    LLMGenerationRequest,
    LLMModelRecord
} from "@server/core/llm/model"

export default async function view() {

    const program = await current.program()

    const application = await Application.init(program.store, program.database)

    current.answer("application.name", () => application.name())

    current.answer("llm-provider.ollama-cloud.configuration", () => application.ollamaCloudConfiguration())

    current.answer<unknown, void>("llm-provider.ollama-cloud.configure", async function ({ payload }) {

        await application.configureOllamaCloud(payload)
    })

    current.answer("llm-provider.ollama-cloud.remove-configuration", async function () {

        await application.removeOllamaCloudConfiguration()
    })

    current.answer("llm-provider.ollama-cloud.activate", async function () {

        await application.activateOllamaCloud()
    })

    current.answer("llm-provider.ollama-cloud.deactivate", async function () {

        await application.deactivateOllamaCloud()
    })

    current.answer<unknown, readonly LLMModelRecord[]>("llm-models", () => application.modelRecords())

    current.answer<unknown, void>("llm-generate", async function ({ payload }) {

        const request = generationRequest(payload)

        for await (const chunk of application.generate(request.provider, request.model, request.input)) {

            current.publish<LLMGenerationEvent>(request.generation, { type: "chunk", chunk })
        }

        current.publish<LLMGenerationEvent>(request.generation, { type: "complete" })
    })
}

function generationRequest(value: unknown): LLMGenerationRequest {

    if (!record(value)) throw new Error("An LLM generation request must be an object")

    const generation = text(value.generation)

    const provider = text(value.provider)

    const model = text(value.model)

    const input = typeof value.input === "string" ? value.input : ""

    if (!generation) throw new Error("An LLM generation request requires an identity")

    if (!provider) throw new Error("An LLM generation request requires an LLM Provider")

    if (!model) throw new Error("An LLM generation request requires an LLM Model")

    if (!input.trim()) throw new Error("An LLM generation request requires input")

    return { generation, provider, model, input }
}

function text(value: unknown) {

    return typeof value === "string" ? value.trim() : ""
}

function record(value: unknown): value is Record<string, unknown> {

    return typeof value === "object" && value !== null && !Array.isArray(value)
}
