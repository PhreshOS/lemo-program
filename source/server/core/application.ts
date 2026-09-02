import type { ProgramStore } from "@phreshos/core"
import type { LLMModelRecord, LLMModelRequest, LLMReasoningLevels } from "./llm/model"
import type { LLMProviderState } from "./llm/provider"
import LLMProviders from "./llm/providers"
import Lemo from "./lemo/lemo"
import type { LemoDatabaseSource } from "./lemo/database"
import type Task from "./lemo/task"

export default class Application {

    private constructor(
        private readonly providers: LLMProviders,
        public readonly lemo: Lemo
    ) {}

    public static async init(
        store: ProgramStore,
        database: LemoDatabaseSource
    ) {

        const providers = await LLMProviders.init(store)

        const lemo = await Lemo.wakeUp(database)

        return new Application(providers, lemo)
    }

    public get llmProviders() {

        return this.providers
    }

    public llmProviderState(identity: string): LLMProviderState {

        return this.providers.state(identity)
    }

    public async configureLLMProvider(identity: string, value: unknown) {

        await this.providers.configure(identity, value)

        return this.providers.state(identity)
    }

    public async removeLLMProviderConfiguration(identity: string) {

        await this.providers.removeConfiguration(identity)

        return this.providers.state(identity)
    }

    public async activateLLMProvider(identity: string) {

        await this.providers.activate(identity)

        return this.providers.state(identity)
    }

    public async deactivateLLMProvider(identity: string) {

        await this.providers.deactivate(identity)

        return this.providers.state(identity)
    }

    public async modelRecords(): Promise<readonly LLMModelRecord[]> {

        return Object.freeze((await this.providers.models()).map(model => Object.freeze({
            provider: model.provider.identity,
            id: model.id,
            reasoning: model.reasoning
        })))
    }

    public async *generate(providerIdentity: string, modelIdentity: string, request: LLMModelRequest) {

        const model = await this.providers.model(providerIdentity, modelIdentity)

        if (!model) throw new Error(`Unknown LLM Model "${providerIdentity}/${modelIdentity}"`)

        return yield* model.generate(request)
    }

    public async modelReasoningLevels(providerIdentity: string, modelIdentity: string): Promise<LLMReasoningLevels | null> {

        const model = await this.providers.model(providerIdentity, modelIdentity)

        if (!model) throw new Error(`Unknown LLM Model "${providerIdentity}/${modelIdentity}"`)

        return await model.reasoningLevels()
    }

    public async modelContextWindow(providerIdentity: string, modelIdentity: string): Promise<number | null> {

        const model = await this.providers.model(providerIdentity, modelIdentity)

        if (!model) throw new Error(`Unknown LLM Model "${providerIdentity}/${modelIdentity}"`)

        return await model.contextWindow()
    }

    public async setModelReasoning(providerIdentity: string, modelIdentity: string, level: string | null) {

        const model = await this.providers.model(providerIdentity, modelIdentity)

        if (!model) throw new Error(`Unknown LLM Model "${providerIdentity}/${modelIdentity}"`)

        await model.setReasoning(level)
    }

    public async task(
        input: string,
        providerIdentity: string,
        modelIdentity: string,
        command?: string
    ): Promise<Task> {

        const model = await this.providers.model(providerIdentity, modelIdentity)

        if (!model) throw new Error(`Unknown LLM Model "${providerIdentity}/${modelIdentity}"`)

        return this.lemo.task({ input, model, command })
    }

    public tasks() {

        return this.lemo.taskProjection()
    }

    public findTask(identity: string) {

        return this.lemo.findTask(identity)
    }

    public async pauseTask(identity: string) {

        const task = await this.requireTask(identity)

        await task.pause()

        return task
    }

    public async cancelTask(identity: string) {

        const task = await this.requireTask(identity)

        await task.cancel()

        return task
    }

    public async continueTask(identity: string) {

        const task = await this.requireTask(identity)
        const coordinates = await task.model()
        const model = await this.providers.model(coordinates.provider, coordinates.id)

        if (!model) {
            throw new Error(`The Task's LLM Model "${coordinates.provider}/${coordinates.id}" is unavailable`)
        }

        await task.continue(model)

        return task
    }

    public respondToTool(task: string, call: string, response: unknown) {

        this.lemo.respond(task, call, response)
    }

    private async requireTask(identity: string) {

        const task = await this.findTask(identity)

        if (!task) throw new Error(`Unknown Lemo Task "${identity}"`)

        return task
    }

}
