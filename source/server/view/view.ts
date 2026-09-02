import type { Launch } from "@phreshos/core"
import { context } from "@phreshos/server"
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

    const program = await context.program()

    const application = await Application.init(program.store, program.database)

    application.lemo.subscribe(operation => context.publish("lemo.operation", operation))

    context.answer("llm-provider.state", function ({ payload }) {

        return application.llmProviderState(providerRequest.parse(payload).provider)
    })

    context.answer<unknown, boolean>("manager.startup", async function () {

        return await program.startup.get() !== null
    })

    context.answer<unknown, void>("manager.startup.configure", async function ({ payload }) {

        const enabled = startupConfiguration.parse(payload).enabled

        if (enabled) await program.startup.enable(fixedLaunch(program.identity))
        else await program.startup.disable()

        context.publish("manager.startup.changed", {
            type: "manager.startup.changed",
            enabled
        })
    })

    context.answer<unknown, void>("llm-provider.configure", async function ({ payload }) {

        const request = providerConfiguration.parse(payload)

        const state = await application.configureLLMProvider(request.provider, request.configuration)

        context.publish("llm-provider.changed", {
            type: "llm-provider.changed",
            provider: request.provider,
            state
        })
    })

    context.answer<unknown, void>("llm-provider.remove-configuration", async function ({ payload }) {

        const provider = providerRequest.parse(payload).provider
        const state = await application.removeLLMProviderConfiguration(provider)

        context.publish("llm-provider.changed", { type: "llm-provider.changed", provider, state })
    })

    context.answer<unknown, void>("llm-provider.activate", async function ({ payload }) {

        const provider = providerRequest.parse(payload).provider
        const state = await application.activateLLMProvider(provider)

        context.publish("llm-provider.changed", { type: "llm-provider.changed", provider, state })
    })

    context.answer<unknown, void>("llm-provider.deactivate", async function ({ payload }) {

        const provider = providerRequest.parse(payload).provider
        const state = await application.deactivateLLMProvider(provider)

        context.publish("llm-provider.changed", { type: "llm-provider.changed", provider, state })
    })

    context.answer<unknown, readonly LLMModelRecord[]>("llm-models", () => application.modelRecords())

    context.answer<unknown, number | null>("llm-model.context-window", function ({ payload }) {

        const request = modelReference.parse(payload)

        return application.modelContextWindow(request.provider, request.model)
    })

    context.answer<unknown, LLMReasoningLevels | null>("llm-model.reasoning-levels", function ({ payload }) {

        const request = modelReference.parse(payload)

        return application.modelReasoningLevels(request.provider, request.model)
    })

    context.answer<unknown, void>("llm-model.set-reasoning", async function ({ payload }) {

        const request = modelReasoning.parse(payload)

        await application.setModelReasoning(request.provider, request.model, request.reasoning)
    })

    context.answer<unknown, readonly TaskSnapshot[]>("lemo.tasks", async function () {

        return Object.freeze(await Promise.all((await application.tasks()).map(task => task.snapshot())))
    })

    context.answer<unknown, void>("lemo.task.create", async function ({ payload }) {

        const request = taskCreation.parse(payload)

        await application.task(request.input, request.provider, request.model, request.command)
    })

    context.answer<unknown, OperationPage>("lemo.task.history", async function ({ payload }) {

        const request = taskHistory.parse(payload)
        const task = await application.findTask(request.task)

        if (!task) throw new Error(`Unknown Lemo Task "${request.task}"`)

        return task.operationsPage(request.limit, request.before)
    })

    context.answer<unknown, void>("lemo.task.pause", async function ({ payload }) {

        await application.pauseTask(taskRequest.parse(payload).task)
    })

    context.answer<unknown, void>("lemo.task.cancel", async function ({ payload }) {

        await application.cancelTask(taskRequest.parse(payload).task)
    })

    context.answer<unknown, void>("lemo.task.continue", async function ({ payload }) {

        await application.continueTask(taskRequest.parse(payload).task)
    })

    context.answer<unknown, void>("lemo.task.tool.respond", function ({ payload }) {

        const request = taskToolResponse.parse(payload)

        application.respondToTool(request.task, request.call, request.response)
    })

    context.answer<unknown, void>("llm-generate", async function ({ payload }) {

        const request = generationRequest.parse(payload)

        const generation = application.generate(request.provider, request.model, request.request)
        let usage = null

        while (true) {

            const event = await generation.next()

            if (event.done) {
                usage = event.value
                break
            }

            context.publish<LLMGenerationEvent>(request.generation, event.value)
        }

        context.publish<LLMGenerationEvent>(request.generation, { type: "complete", usage })
    })

    // Start the representation only after its Server API is complete.
    void startAgent().catch(error => console.error(error))
}

async function startAgent() {

    if (!await context.client.exists()) await context.client.start({ location: "/agent" })
}

function fixedLaunch(identity: string): Launch {

    return Object.freeze({ name: identity, server: true, client: false })
}
