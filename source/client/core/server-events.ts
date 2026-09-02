import type { ServerEndpoint } from "@phreshos/client"

export type LemoServerEvents = {
    "lemo.operation": unknown
    "llm-provider.changed": unknown
    "manager.startup.changed": unknown
}

export type LemoServer = ServerEndpoint<LemoServerEvents, unknown>

type LemoEvent = keyof LemoServerEvents | (string & {})

/** Applies Lemo's publication contract to one concrete Server Endpoint handle. */
export function lemoServer(server: ServerEndpoint): LemoServer {

    return server as unknown as LemoServer
}

/** Opens a bounded Server Endpoint event stream before any accompanying snapshot request. */
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
