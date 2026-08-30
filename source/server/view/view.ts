import type { Launch } from "@phreshos/core"
import { current } from "@phreshos/server"
import Application from "@server/core/application"
import type {
    LLMGenerationEvent,
    LLMModelRecord,
    LLMReasoningLevels
} from "@server/core/llm/model"
import type { TaskSnapshot } from "@server/core/lemo/task"
import type { OperationPage } from "@server/core/lemo/database"
import {
    generationRequest,
    modelReasoning,
    modelReference,
    providerConfiguration,
    providerRequest,
    startupConfiguration,
    taskCreation,
    taskHistory,
    taskRequest,
    taskToolResponse
} from "./contract"

export default async function view() {

    const program = await current.program()

    const application = await Application.init(program.store, program.database)

    application.lemo.subscribe(operation => current.publish("lemo.operation", operation))

    current.answer("llm-provider.state", function ({ payload }) {

        return application.llmProviderState(providerRequest.parse(payload).provider)
    })

    current.answer<unknown, boolean>("manager.startup", async function () {

        return await program.startup.get() !== null
    })

    current.answer<unknown, void>("manager.startup.configure", async function ({ payload }) {

        const enabled = startupConfiguration.parse(payload).enabled

        if (enabled) await program.startup.enable(fixedLaunch(program.identity))
        else await program.startup.disable()

        current.publish("manager.startup.changed", {
            type: "manager.startup.changed",
            enabled
        })
    })

    current.answer<unknown, void>("llm-provider.configure", async function ({ payload }) {

        const request = providerConfiguration.parse(payload)

        const state = await application.configureLLMProvider(request.provider, request.configuration)

        current.publish("llm-provider.changed", {
            type: "llm-provider.changed",
            provider: request.provider,
            state
        })
    })

    current.answer<unknown, void>("llm-provider.remove-configuration", async function ({ payload }) {

        const provider = providerRequest.parse(payload).provider
        const state = await application.removeLLMProviderConfiguration(provider)

        current.publish("llm-provider.changed", { type: "llm-provider.changed", provider, state })
    })

    current.answer<unknown, void>("llm-provider.activate", async function ({ payload }) {

        const provider = providerRequest.parse(payload).provider
        const state = await application.activateLLMProvider(provider)

        current.publish("llm-provider.changed", { type: "llm-provider.changed", provider, state })
    })

    current.answer<unknown, void>("llm-provider.deactivate", async function ({ payload }) {

        const provider = providerRequest.parse(payload).provider
        const state = await application.deactivateLLMProvider(provider)

        current.publish("llm-provider.changed", { type: "llm-provider.changed", provider, state })
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

    current.answer<unknown, void>("lemo.task.tool.respond", function ({ payload }) {

        const request = taskToolResponse.parse(payload)

        application.respondToTool(request.task, request.call, request.response)
    })

    current.answer<unknown, void>("llm-generate", async function ({ payload }) {

        const request = generationRequest.parse(payload)

        for await (const event of application.generate(request.provider, request.model, request.request)) {

            current.publish<LLMGenerationEvent>(request.generation, event)
        }

        current.publish<LLMGenerationEvent>(request.generation, { type: "complete" })
    })

    // Start the representation only after its Server API is complete.
    void startAgent().catch(error => console.error(error))
}

async function startAgent() {

    if (!await current.client.exists()) await current.client.start({ location: "/agent" })
}

function fixedLaunch(identity: string): Launch {

    return Object.freeze({ name: identity, server: true, client: false })
}
