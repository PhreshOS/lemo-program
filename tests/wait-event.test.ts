import { afterEach, expect, test, vi } from "vitest"
import type { Subscribable } from "@phreshos/core"
import waitEvent from "../source/server/core/lemo/runtime/wait-event"

afterEach(() => vi.useRealTimers())

test("an already cancelled wait never subscribes", async () => {
    const events = vi.fn()
    const controller = new AbortController()
    controller.abort(new Error("Task stopped"))
    await expect(waitEvent({ events } as unknown as Subscribable, "change", controller.signal)).rejects.toThrow("Task stopped")
    expect(events).not.toHaveBeenCalled()
})

test("a failed subscription releases its deadline", async () => {
    vi.useFakeTimers()
    const events = () => { throw new Error("Endpoint unavailable") }
    await expect(waitEvent({ events } as unknown as Subscribable, "change", new AbortController().signal)).rejects.toThrow("Endpoint unavailable")
    expect(vi.getTimerCount()).toBe(0)
})
