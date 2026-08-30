import { current } from "@phreshos/server"
import Application from "@server/core/application"
import type {
    LLMGenerationEvent,
    LLMModelRecord,
    LLMReasoningLevels
} from "@server/core/llm/model"
import type { TaskSnapshot } from "@server/core/lemo/task"
import type { OperationPage } from "@server/core/lemo/database"
import type ClientChannel from "@server/core/client-channel"
import {
    generationRequest,
    modelReasoning,
    modelReference,
    providerConfiguration,
    providerRequest,
    startupConfiguration,
    taskCreation,
    taskHistory,
    taskRequest
} from "./contract"

export default async function view() {

    const program = await current.program()

    const application = await Application.init(program.store, program.database, clientChannel, {
        client: current.client,
        identity: program.identity,
        startup: program.startup
    })

    application.subscribe(event => {

        if (event.type === "lemo.operation") current.publish(event.type, event.operation)
        else current.publish(event.type, event)
    })

    current.answer("llm-provider.state", function ({ payload }) {

        return application.llmProviderState(providerRequest.parse(payload).provider)
    })

    current.answer<unknown, boolean>("manager.startup", () => application.startupEnabled())

    current.answer<unknown, void>("manager.startup.configure", async function ({ payload }) {

        await application.configureStartup(startupConfiguration.parse(payload).enabled)
    })

    current.answer<unknown, void>("llm-provider.configure", async function ({ payload }) {

        const request = providerConfiguration.parse(payload)

        await application.configureLLMProvider(request.provider, request.configuration)
    })

    current.answer<unknown, void>("llm-provider.remove-configuration", async function ({ payload }) {

        await application.removeLLMProviderConfiguration(providerRequest.parse(payload).provider)
    })

    current.answer<unknown, void>("llm-provider.activate", async function ({ payload }) {

        await application.activateLLMProvider(providerRequest.parse(payload).provider)
    })

    current.answer<unknown, void>("llm-provider.deactivate", async function ({ payload }) {

        await application.deactivateLLMProvider(providerRequest.parse(payload).provider)
    })

    current.answer<unknown, readonly LLMModelRecord[]>("llm-models", () => application.modelRecords())

    current.answer<unknown, number | null>("llm-model.context-window", function ({ payload }) {

        const request = modelReference.parse(payload)

        return application.modelContextWindow(request.provider, request.model)
    })

    current.answer<unknown, LLMReasoningLevels | null>("llm-model.reasoning-levels", function ({ payload }) {

        const request = modelReference.parse(payload)

        return application.modelReasoningLevels(request.provider, request.model)
    })

    current.answer<unknown, void>("llm-model.set-reasoning", async function ({ payload }) {

        const request = modelReasoning.parse(payload)

        await application.setModelReasoning(request.provider, request.model, request.reasoning)
    })

    current.answer<unknown, readonly TaskSnapshot[]>("lemo.tasks", async function () {

        return Object.freeze(await Promise.all((await application.tasks()).map(task => task.snapshot())))
    })

    current.answer<unknown, void>("lemo.task.create", async function ({ payload }) {

        const request = taskCreation.parse(payload)

        await application.task(request.input, request.provider, request.model, request.command)
    })

    current.answer<unknown, OperationPage>("lemo.task.history", async function ({ payload }) {

        const request = taskHistory.parse(payload)
        const task = await application.findTask(request.task)

        if (!task) throw new Error(`Unknown Lemo Task "${request.task}"`)

        return task.operationsPage(request.limit, request.before)
    })

    current.answer<unknown, void>("lemo.task.pause", async function ({ payload }) {

        await application.pauseTask(taskRequest.parse(payload).task)
    })

    current.answer<unknown, void>("lemo.task.cancel", async function ({ payload }) {

        await application.cancelTask(taskRequest.parse(payload).task)
    })

    current.answer<unknown, void>("lemo.task.continue", async function ({ payload }) {

        await application.continueTask(taskRequest.parse(payload).task)
    })

    current.answer<unknown, void>("llm-generate", async function ({ payload }) {

        const request = generationRequest.parse(payload)

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
