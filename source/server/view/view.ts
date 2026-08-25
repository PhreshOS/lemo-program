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
import type { TaskSnapshot } from "@server/core/lemo/task"
import type ClientChannel from "@server/core/client-channel"

export default async function view() {

    const program = await current.program()

    const application = await Application.init(program.store, program.database, clientChannel, {
        client: current.client,
        identity: program.identity,
        startup: program.startup
    })

    application.subscribe(operation => current.publish("lemo.operation", operation))

    current.answer("llm-provider.state", function ({ payload }) {

        return application.llmProviderState(providerIdentity(payload))
    })

    current.answer<unknown, boolean>("manager.startup", () => application.startupEnabled())

    current.answer<unknown, void>("manager.startup.configure", async function ({ payload }) {

        await application.configureStartup(enabledRequest(payload))
    })

    current.answer<unknown, void>("llm-provider.configure", async function ({ payload }) {

        const request = providerConfiguration(payload)

        await application.configureLLMProvider(request.provider, request.configuration)
    })

    current.answer("llm-provider.remove-configuration", async function ({ payload }) {

        await application.removeLLMProviderConfiguration(providerIdentity(payload))
    })

    current.answer("llm-provider.activate", async function ({ payload }) {

        await application.activateLLMProvider(providerIdentity(payload))
    })

    current.answer("llm-provider.deactivate", async function ({ payload }) {

        await application.deactivateLLMProvider(providerIdentity(payload))
    })

    current.answer<unknown, readonly LLMModelRecord[]>("llm-models", () => application.modelRecords())

    current.answer<unknown, readonly TaskSnapshot[]>("lemo.tasks", async function () {

        return Object.freeze(await Promise.all((await application.tasks()).map(task => task.snapshot())))
    })

    current.answer<unknown, TaskSnapshot>("lemo.task.create", async function ({ payload }) {

        const request = taskCreateRequest(payload)

        const task = await application.task(request.input, request.provider, request.model)

        return task.snapshot()
    })

    current.answer<unknown, TaskSnapshot>("lemo.task.open", async function ({ payload }) {

        const request = taskOpenRequest(payload)

        const task = await application.findTask(request.task)

        if (!task) throw new Error(`Unknown Lemo Task "${request.task}"`)

        return task.snapshot()
    })

    current.answer<unknown, TaskSnapshot>("lemo.task.pause", async function ({ payload }) {

        return (await application.pauseTask(taskIdentity(payload))).snapshot()
    })

    current.answer<unknown, TaskSnapshot>("lemo.task.cancel", async function ({ payload }) {

        return (await application.cancelTask(taskIdentity(payload))).snapshot()
    })

    current.answer<unknown, TaskSnapshot>("lemo.task.continue", async function ({ payload }) {

        return (await application.continueTask(taskIdentity(payload))).snapshot()
    })

    current.answer<unknown, void>("llm-generate", async function ({ payload }) {

        const request = generationRequest(payload)

        for await (const event of application.generate(request.provider, request.model, request.request)) {

            current.publish<LLMGenerationEvent>(request.generation, event)
        }

        current.publish<LLMGenerationEvent>(request.generation, { type: "complete" })
    })

    // Process creation must settle independently. Server Core owns this
    // lifecycle, while View only starts it after every Server capability has
    // been registered.
    void application.start().catch(error => console.error(error))
}

function enabledRequest(value: unknown) {

    if (!record(value) || typeof value.enabled !== "boolean") {
        throw new Error("A Lemo startup request requires an enabled boolean")
    }

    return value.enabled
}

const clientChannel: ClientChannel = {
    publish(event, payload) {

        current.client.publish(event, payload)
    },
    subscribe(event, listener) {

        return current.subscribe(event, value => {

            listener((value as { payload: unknown }).payload)
        })
    }
}

function taskIdentity(value: unknown) {

    if (!record(value)) throw new Error("A Lemo Task control request must be an object")

    const task = text(value.task)

    if (!task) throw new Error("A Lemo Task control request requires an identity")

    return task
}

function providerIdentity(value: unknown) {

    if (!record(value)) throw new Error("An LLM Provider request must be an object")

    const provider = text(value.provider)

    if (!provider) throw new Error("An LLM Provider request requires an identity")

    return provider
}

function providerConfiguration(value: unknown) {

    const provider = providerIdentity(value)

    return { provider, configuration: (value as Record<string, unknown>).configuration }
}

function taskCreateRequest(value: unknown) {

    if (!record(value)) throw new Error("A Lemo Task request must be an object")

    const input = text(value.input)

    const provider = text(value.provider)

    const model = text(value.model)

    if (!input) throw new Error("A Lemo Task request requires input")

    if (!provider || !model) throw new Error("A Lemo Task request requires an LLM Model")

    return { input, provider, model }
}

function taskOpenRequest(value: unknown) {

    if (!record(value)) throw new Error("Opening a Lemo Task requires an object")

    const task = text(value.task)

    if (!task) throw new Error("Opening a Lemo Task requires an identity")

    return { task }
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

        const call = text(value.call)

        const name = text(value.name)

        if (!call || !name) throw new Error("An LLM tool message requires call and Tool identities")

        return Object.freeze({ role, call, name, content: value.content })
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
