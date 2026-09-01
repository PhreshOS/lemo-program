import type { Server } from "@phreshos/client"

export type LemoServerEvents = {
    "lemo.operation": unknown
    "llm-provider.changed": unknown
    "manager.startup.changed": unknown
}

export type LemoServer = Server<LemoServerEvents, unknown>

type LemoEvent = keyof LemoServerEvents | (string & {})

/** Applies Lemo's publication contract to one concrete Server handle. */
export function lemoServer(server: Server): LemoServer {

    return server as unknown as LemoServer
}

/** Opens a bounded Server event stream before any accompanying snapshot request. */
export default function serverEvents(server: LemoServer, event: LemoEvent, capacity = 256) {

    const controller = new AbortController()
    const source = server.events<unknown>(event, { capacity, signal: controller.signal })
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
