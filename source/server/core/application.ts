import type { ProgramStore } from "@phreshos/core"
import type { LLMModelRecord, LLMModelRequest } from "./llm/model"
import type { LLMProviderState } from "./llm/provider"
import LLMProviders from "./llm/providers"
import Lemo from "./lemo/lemo"
import type { LemoDatabaseSource } from "./lemo/database"
import type Task from "./lemo/task"
import type ClientChannel from "./client-channel"

export default class Application {

    private constructor(
        private readonly providers: LLMProviders,
        public readonly lemo: Lemo
    ) {}

    public static async init(store: ProgramStore, database: LemoDatabaseSource, client: ClientChannel) {

        const providers = await LLMProviders.init(store)

        const lemo = await Lemo.wakeUp(database, client)

        return new Application(providers, lemo)
    }

    public get llmProviders() {

        return this.providers
    }

    public llmProviderState(identity: string): LLMProviderState {

        return this.providers.state(identity)
    }

    public configureLLMProvider(identity: string, value: unknown) {

        return this.providers.configure(identity, value)
    }

    public removeLLMProviderConfiguration(identity: string) {

        return this.providers.removeConfiguration(identity)
    }

    public activateLLMProvider(identity: string) {

        return this.providers.activate(identity)
    }

    public deactivateLLMProvider(identity: string) {

        return this.providers.deactivate(identity)
    }

    public async modelRecords(): Promise<readonly LLMModelRecord[]> {

        return Object.freeze((await this.providers.models()).map(model => Object.freeze({
            provider: model.provider.identity,
            id: model.id
        })))
    }

    public async *generate(providerIdentity: string, modelIdentity: string, request: LLMModelRequest) {

        const model = await this.providers.model(providerIdentity, modelIdentity)

        if (!model) throw new Error(`Unknown LLM Model "${providerIdentity}/${modelIdentity}"`)

        yield* model.generate(request)
    }

    public async task(input: string, providerIdentity: string, modelIdentity: string): Promise<Task> {

        const model = await this.providers.model(providerIdentity, modelIdentity)

        if (!model) throw new Error(`Unknown LLM Model "${providerIdentity}/${modelIdentity}"`)

        return this.lemo.task({ input, model })
    }

    public tasks() {

        return this.lemo.tasks()
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

    private async requireTask(identity: string) {

        const task = await this.findTask(identity)

        if (!task) throw new Error(`Unknown Lemo Task "${identity}"`)

        return task
    }

}
