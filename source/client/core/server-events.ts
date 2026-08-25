import type { Server } from "@phreshos/client"

/** Opens a bounded Server event stream before any accompanying snapshot request. */
export default function serverEvents(server: Server, event: string, capacity = 256) {

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
