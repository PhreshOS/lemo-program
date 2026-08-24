import type { Subscribable } from "@phreshos/core"

const defaultEventTimeout = 10_000

/** Waits for one event without allowing a Task to leave a subscription behind. */
export default async function waitEvent<Events extends object, Fallback>(
    source: Subscribable<Events, Fallback>,
    event: string,
    signal: AbortSignal,
    timeout = defaultEventTimeout
) {

    const controller = new AbortController()
    let timedOut = false
    const abort = () => controller.abort(signal.reason)
    const timer = setTimeout(() => {

        timedOut = true
        controller.abort()
    }, timeout)

    signal.addEventListener("abort", abort, { once: true })

    const events = (source as unknown as Subscribable).events(event, {
        capacity: 1,
        signal: controller.signal
    })

    try {

        const result = await events.next()

        if (!result.done) return result.value

        if (timedOut) throw new Error(`Event promise timeout ${timeout}ms`)

        throw signal.reason instanceof Error
            ? signal.reason
            : new Error("Event waiting was cancelled")
    } finally {

        clearTimeout(timer)
        signal.removeEventListener("abort", abort)
        controller.abort()
        await events.return?.()
    }
}
