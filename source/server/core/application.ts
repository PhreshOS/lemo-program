import type { Launch, LaunchClient, ProgramStore } from "@phreshos/core"
import type { LLMModelRecord, LLMModelRequest } from "./llm/model"
import type { LLMProviderState } from "./llm/provider"
import LLMProviders from "./llm/providers"
import Lemo from "./lemo/lemo"
import type { LemoDatabaseSource } from "./lemo/database"
import type Task from "./lemo/task"
import type ClientChannel from "./client-channel"
import type { ApplicationEvent } from "./application-event"

export default class Application {

    private readonly subscribers = new Set<(event: ApplicationEvent) => void>()

    private constructor(
        private readonly providers: LLMProviders,
        public readonly lemo: Lemo,
        private readonly environment: ApplicationEnvironment
    ) {}

    public static async init(
        store: ProgramStore,
        database: LemoDatabaseSource,
        channel: ClientChannel,
        environment: ApplicationEnvironment
    ) {

        const providers = await LLMProviders.init(store)

        const lemo = await Lemo.wakeUp(database, channel)

        const application = new Application(providers, lemo, environment)

        lemo.subscribe(operation => application.publish({ type: "lemo.operation", operation }))

        return application
    }

    public get llmProviders() {

        return this.providers
    }

    /** Starts the paired Agent Client without extending Server construction. */
    public start() {

        return this.startAgent(this.environment.client)
    }

    public llmProviderState(identity: string): LLMProviderState {

        return this.providers.state(identity)
    }

    public async configureLLMProvider(identity: string, value: unknown) {

        await this.providers.configure(identity, value)
        this.publishProvider(identity)
    }

    public async removeLLMProviderConfiguration(identity: string) {

        await this.providers.removeConfiguration(identity)
        this.publishProvider(identity)
    }

    public async activateLLMProvider(identity: string) {

        await this.providers.activate(identity)
        this.publishProvider(identity)
    }

    public async deactivateLLMProvider(identity: string) {

        await this.providers.deactivate(identity)
        this.publishProvider(identity)
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

    public async startupEnabled() {

        return await this.environment.startup.get() !== null
    }

    public async configureStartup(enabled: boolean) {

        if (enabled) await this.environment.startup.enable(fixedLaunch(this.environment.identity))
        else await this.environment.startup.disable()

        this.publish({ type: "manager.startup.changed", enabled })
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

    public subscribe(subscriber: (event: ApplicationEvent) => void) {

        this.subscribers.add(subscriber)

        return () => { this.subscribers.delete(subscriber) }
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

    private async startAgent(client: PairedClient) {

        if (!await client.exists()) await client.start({ location: "/agent" })
    }

    private publishProvider(provider: string) {

        this.publish({
            type: "llm-provider.changed",
            provider,
            state: this.providers.state(provider)
        })
    }

    private publish(event: ApplicationEvent) {

        for (const subscriber of this.subscribers) {
            try {
                subscriber(event)
            } catch {
                this.subscribers.delete(subscriber)
            }
        }
    }

}

function fixedLaunch(identity: string): Launch {

    return Object.freeze({ name: identity, server: true, client: false })
}

export type ApplicationEnvironment = Readonly<{
    client: PairedClient
    identity: string
    startup: Startup
}>

export interface PairedClient {
    exists(): Promise<boolean>
    start(overrides?: LaunchClient): Promise<void>
}

export interface Startup {
    get(): Promise<Launch | null>
    enable(launch?: Launch): Promise<void>
    disable(): Promise<void>
}
