import type { Process, Program, Server } from "@phreshos/client"
import LLMProviders from "./llm/providers"
import { llmServerSources } from "./llm/server"
import serverEvents from "./server-events"

const fixedLaunch = (program: Program) => Object.freeze({
    name: program.identity,
    server: true,
    client: false
} as const)

/** Core of the Client-only Lemo Manager route. */
export default class Manager {

    private process: Process | null = null
    private startupEnabled: boolean | null = null
    private startupRevision = 0
    private readonly startupSubscribers = new Set<() => void>()
    private startupChannel: ReturnType<typeof serverEvents> | null = null
    private startupError: unknown

    private constructor(private readonly program: Program) {}

    public static async open(program: Program) {

        const manager = new Manager(program)

        await manager.ensureProcess()
        await manager.openStartupProjection()

        return manager
    }

    public async llmProviders() {

        const sources = llmServerSources(await this.server())

        const providers = new LLMProviders(sources.models, sources.providers)

        await providers.start()

        return providers
    }

    public async startup() {

        if (this.startupError !== undefined) throw this.startupError
        if (this.startupEnabled === null) throw new Error("The startup projection is unavailable")

        return this.startupEnabled
    }

    public async enableStartup(enabled: boolean) {

        await (await this.server()).ask("manager.startup.configure", { enabled })
    }

    public async launch() {

        const process = await this.ensureProcess()

        await process.server.waitReady()

        if (!await process.client.exists()) {
            throw new Error("Lemo Server is ready but its Agent Client did not start")
        }

        await process.client.window.minimize(false)
        await process.client.window.raise()
    }

    public subscribeStartup(subscriber: () => void) {

        this.startupSubscribers.add(subscriber)

        return () => { this.startupSubscribers.delete(subscriber) }
    }

    public startupVersion() {

        return this.startupRevision
    }

    public stop() {

        this.startupChannel?.close()
        this.startupChannel = null
    }

    private async server(): Promise<Server> {

        return (await this.ensureProcess()).server
    }

    private async ensureProcess() {

        if (!this.process || await this.process.exited()) {
            this.process = await this.program.process.findOrCreate(fixedLaunch(this.program))
        }

        return this.process
    }

    private async openStartupProjection() {

        const server = await this.server()
        const channel = serverEvents(server, "manager.startup.changed", 32)

        try {
            this.startupEnabled = await server.ask<boolean>("manager.startup")
            this.startupChannel = channel
            void this.followStartup(channel)
        } catch (cause) {
            channel.close()

            throw cause
        }
    }

    private async followStartup(channel: ReturnType<typeof serverEvents>) {

        try {
            for await (const value of channel.events) {

                if (!startupEvent(value)) throw new Error("The Server published invalid startup state")

                this.startupEnabled = value.enabled
                this.startupRevision++

                for (const subscriber of this.startupSubscribers) subscriber()
            }
        } catch (cause) {
            this.startupError = cause
            this.startupRevision++

            for (const subscriber of this.startupSubscribers) subscriber()
        } finally {
            if (this.startupChannel === channel) this.startupChannel = null

            channel.close()
        }
    }
}

function startupEvent(value: unknown): value is Readonly<{
    type: "manager.startup.changed"
    enabled: boolean
}> {

    return typeof value === "object"
        && value !== null
        && (value as { type?: unknown }).type === "manager.startup.changed"
        && typeof (value as { enabled?: unknown }).enabled === "boolean"
}
