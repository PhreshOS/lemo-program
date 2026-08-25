import type { Process, Program, Server } from "@phreshos/client"
import LLMProviders from "./llm/providers"
import { llmServerSources } from "./llm/server"

const fixedLaunch = (program: Program) => Object.freeze({
    name: program.identity,
    server: true,
    client: false
} as const)

/** Core of the Client-only Lemo Manager route. */
export default class Manager {

    private process: Process | null = null

    private constructor(private readonly program: Program) {}

    public static async open(program: Program) {

        const manager = new Manager(program)

        await manager.ensureProcess()

        return manager
    }

    public async llmProviders() {

        const sources = llmServerSources(await this.server())

        return new LLMProviders(sources.models, sources.providers)
    }

    public async startup() {

        return await (await this.server()).ask<boolean>("manager.startup")
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

    private async server(): Promise<Server> {

        return (await this.ensureProcess()).server
    }

    private async ensureProcess() {

        if (!this.process || await this.process.exited()) {
            this.process = await this.program.process.findOrCreate(fixedLaunch(this.program))
        }

        return this.process
    }
}
