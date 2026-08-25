import type { Server } from "@phreshos/client"
import LLMProviders from "./llm/providers"
import { llmServerSources } from "./llm/server"
import Lemo, { type LemoSource } from "./lemo/lemo"
import type LLMModel from "./llm/model"
import { taskSnapshot } from "./lemo/task"
import Prompts, { type PromptSource } from "./prompts/prompts"

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
    }

    public stop() {

        this.prompts.stop()
        this.lemo.stop()
    }

}

function serverLemoSource(server: Server): LemoSource {

    return {
        async observe() {

            const channel = eventChannel(server, "lemo.operation")

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
        async create(input: string, model: LLMModel) {

            return taskSnapshot(await server.ask<unknown>("lemo.task.create", {
                input,
                provider: model.provider.identity,
                model: model.id
            }))
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
        continue: () => controlTask(server, "lemo.task.continue", task)
    })
}

async function controlTask(server: Server, operation: string, task: string) {

    return taskSnapshot(await server.ask<unknown>(operation, { task }))
}

function eventChannel(server: Server, event: string) {

    const controller = new AbortController()

    const source = server.events<unknown>(event, {
        capacity: eventQueueCapacity,
        signal: controller.signal
    })

    const iterator = source[Symbol.asyncIterator]()

    let next = iterator.next()

    const events: AsyncIterable<unknown> = {
        [Symbol.asyncIterator]() {

            return {
                async next() {

                    const result = await next

                    if (!result.done) next = iterator.next()

                    return result
                },
                async return() {

                    return await iterator.return?.() ?? { value: undefined, done: true }
                }
            }
        }
    }

    return Object.freeze({ events, close: () => controller.abort() })
}

const eventQueueCapacity = 256
