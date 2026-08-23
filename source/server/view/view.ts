import { current } from "@phreshos/server"
import Application from "@server/core/application"
import type {
    LLMGenerationEvent,
    LLMGenerationRequest,
    LLMMessage,
    LLMModelRequest,
    LLMModelRecord,
    LLMToolCall,
    LLMToolDefinition
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

        for await (const event of application.generate(request.provider, request.model, request.request)) {

            current.publish<LLMGenerationEvent>(request.generation, event)
        }

        current.publish<LLMGenerationEvent>(request.generation, { type: "complete" })
    })
}

function generationRequest(value: unknown): LLMGenerationRequest {

    if (!record(value)) throw new Error("An LLM generation request must be an object")

    const generation = text(value.generation)

    const provider = text(value.provider)

    const model = text(value.model)

    const request = modelRequest(value.request)

    if (!generation) throw new Error("An LLM generation request requires an identity")

    if (!provider) throw new Error("An LLM generation request requires an LLM Provider")

    if (!model) throw new Error("An LLM generation request requires an LLM Model")

    return { generation, provider, model, request }
}

function modelRequest(value: unknown): LLMModelRequest {

    if (!record(value) || !Array.isArray(value.messages) || !value.messages.length) {

        throw new Error("An LLM generation request requires messages")
    }

    if (!Array.isArray(value.tools)) throw new Error("An LLM generation request requires tools")

    return Object.freeze({
        messages: Object.freeze(value.messages.map(message)),
        tools: Object.freeze(value.tools.map(tool))
    })
}

function message(value: unknown): LLMMessage {

    if (!record(value)) throw new Error("An LLM message must be an object")

    const role = value.role

    if (role !== "system" && role !== "user" && role !== "assistant" && role !== "tool") {

        throw new Error("An LLM message has an invalid role")
    }

    if (typeof value.content !== "string") {

        throw new Error("An LLM message requires content")
    }

    if (role === "tool") {

        const name = text(value.name)

        if (!name) throw new Error("An LLM tool message requires a name")

        return Object.freeze({ role, name, content: value.content })
    }

    if (role === "assistant" && value.toolCalls !== undefined) {

        if (!Array.isArray(value.toolCalls)) throw new Error("An assistant message has invalid tool calls")

        return Object.freeze({
            role,
            content: value.content,
            toolCalls: Object.freeze(value.toolCalls.map(toolCall))
        })
    }

    return Object.freeze({ role, content: value.content })
}

function tool(value: unknown): LLMToolDefinition {

    if (!record(value)) throw new Error("An LLM tool definition must be an object")

    const name = text(value.name)

    const description = text(value.description)

    if (!name || !description || !record(value.parameters)) {

        throw new Error("An LLM tool definition is invalid")
    }

    return Object.freeze({ name, description, parameters: Object.freeze({ ...value.parameters }) })
}

function toolCall(value: unknown): LLMToolCall {

    if (!record(value)) throw new Error("An LLM tool call must be an object")

    const id = text(value.id)

    const name = text(value.name)

    if (!id || !name) throw new Error("An LLM tool call is invalid")

    return Object.freeze({ id, name, input: value.input })
}

function text(value: unknown) {

    return typeof value === "string" ? value.trim() : ""
}

function record(value: unknown): value is Record<string, unknown> {

    return typeof value === "object" && value !== null && !Array.isArray(value)
}
