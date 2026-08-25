import type { Server } from "@phreshos/client"
import LLMProviders from "./llm/providers"
import { llmServerSources } from "./llm/server"
import Lemo, { type LemoSource } from "./lemo/lemo"
import type LLMModel from "./llm/model"
import { taskSnapshot } from "./lemo/task"
import Prompts, { type PromptSource } from "./prompts/prompts"
import serverEvents from "./server-events"

export default class Application {

    public readonly llmProviders: LLMProviders
    public readonly lemo: Lemo
    public readonly prompts: Prompts

    public constructor(server: Server, promptSource: PromptSource) {

        const sources = llmServerSources(server)

        this.llmProviders = new LLMProviders(sources.models, sources.providers)
        this.lemo = new Lemo(serverLemoSource(server))
        this.prompts = new Prompts(promptSource)
    }

    public start() {

        this.prompts.start()

        return this.llmProviders.start()
    }

    public stop() {

        this.prompts.stop()
        this.lemo.stop()
        this.llmProviders.stop()
    }

}

function serverLemoSource(server: Server): LemoSource {

    return {
        async observe() {

            const channel = serverEvents(server, "lemo.operation")

            try {
                const value = await server.ask<unknown>("lemo.tasks")

                if (!Array.isArray(value)) throw new Error("The Server returned an invalid Lemo Task list")

                return Object.freeze({
                    snapshots: Object.freeze(value.map(taskSnapshot)),
                    events: channel.events,
                    close: channel.close
                })
            } catch (error) {
                channel.close()

                throw error
            }
        },
        async create(command: string, input: string, model: LLMModel) {

            await server.ask("lemo.task.create", {
                command,
                input,
                provider: model.provider.identity,
                model: model.id
            })
        },
        control(task: string) {

            return taskControl(server, task)
        }
    }
}

function taskControl(server: Server, task: string) {

    return Object.freeze({
        pause: () => controlTask(server, "lemo.task.pause", task),
        cancel: () => controlTask(server, "lemo.task.cancel", task),
        continue: () => controlTask(server, "lemo.task.continue", task),
        history: (limit: number, before: number) => server.ask<unknown>("lemo.task.history", {
            task,
            limit,
            before
        })
    })
}

async function controlTask(server: Server, operation: string, task: string) {

    await server.ask(operation, { task })
}
