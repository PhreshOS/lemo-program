import { current } from "@phreshos/server"
import Application from "@server/core/application"
import type {
    LLMGenerationEvent,
    LLMGenerationRequest,
    LLMModelRecord,
    LLMModelsRequest
} from "@server/core/llm/model"

export default async function view() {

    const program = await current.program()

    const application = await Application.init(program.store)

    current.answer("application.name", () => application.name())

    current.answer("llm-provider.ollama-cloud.configuration", () => application.ollamaCloudConfiguration())

    current.answer<unknown, void>("llm-provider.ollama-cloud.configure", async function ({ payload }) {

        await application.configureOllamaCloud(payload)
    })

    current.answer("llm-provider.ollama-cloud.remove-configuration", async function () {

        await application.removeOllamaCloudConfiguration()
    })

    current.answer<unknown, readonly LLMModelRecord[]>("llm-models", async function ({ payload }) {

        const request = modelsRequest(payload)

        return await application.modelRecords(request.provider)
    })

    current.answer<unknown, void>("llm-generate", async function ({ payload }) {

        const request = generationRequest(payload)

        for await (const chunk of application.generate(request.provider, request.model, request.input)) {

            current.publish<LLMGenerationEvent>(request.generation, { type: "chunk", chunk })
        }

        current.publish<LLMGenerationEvent>(request.generation, { type: "complete" })
    })
}

function modelsRequest(value: unknown): LLMModelsRequest {

    if (!record(value)) throw new Error("An LLM Models request must be an object")

    const provider = text(value.provider)

    if (!provider) throw new Error("An LLM Models request requires an LLM Provider")

    return { provider }
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
