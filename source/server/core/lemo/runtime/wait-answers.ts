import type {
    PromptEvent,
    PromptRecord,
    PromptRelease
} from "@client/core/prompts/contract"
import type ClientChannel from "@server/core/client-channel"
import { z } from "zod"

const response = z.strictObject({
    id: z.string().trim().min(1),
    content: z.string().trim().min(1).max(4_000)
})

const ready = z.strictObject({
    client: z.string().trim().min(1)
})

const defaultCapacity = 4
const defaultTimeout = 2 * 60 * 1_000

type Pending = Readonly<{
    prompt: PromptRecord
    resolve(content: string): void
    cancel(): void
}>

export type WaitAnswerContext = Readonly<{
    task: string
    call: string
}>

export type WaitAnswerRequest = Readonly<{
    content: string
}>

/** Runtime's bounded owner of pending responses from the paired Client. */
export default class WaitAnswers {

    private readonly pending = new Map<string, Pending>()

    public constructor(
        private readonly client: ClientChannel,
        private readonly capacity = defaultCapacity,
        private readonly timeout = defaultTimeout,
        private readonly now: () => number = Date.now
    ) {

        if (!Number.isInteger(capacity) || capacity < 1) {
            throw new Error("Runtime waitAnswer capacity must be a positive integer")
        }

        if (!Number.isInteger(timeout) || timeout <= 0) {
            throw new Error("Runtime waitAnswer timeout must be a positive integer")
        }

        client.subscribe("lemo.prompt.response" satisfies PromptEvent, value => this.receive(value))
        client.subscribe("lemo.prompt.ready" satisfies PromptEvent, value => this.restore(value))
    }

    public wait(context: WaitAnswerContext, request: WaitAnswerRequest, signal: AbortSignal): Promise<string> {

        const content = request.content.trim()

        if (!content) throw new Error("waitAnswer requires prompt content")
        if (content.length > 4_000) throw new Error("waitAnswer prompt content cannot exceed 4000 characters")
        if (this.pending.size >= this.capacity) {
            throw new Error(`Runtime already has its maximum of ${this.capacity} pending answers`)
        }

        if (signal.aborted) throw signal.reason ?? new Error("Task run stopped")

        const createdAt = this.now()

        if (!Number.isInteger(createdAt) || createdAt < 0) {
            throw new Error("Runtime's clock returned an invalid time")
        }

        const prompt: PromptRecord = Object.freeze({
            id: crypto.randomUUID(),
            task: context.task,
            call: context.call,
            content,
            createdAt,
            expiresAt: createdAt + this.timeout
        })

        return new Promise<string>((resolve, reject) => {

            let settled = false

            const settle = (reason: PromptRelease["reason"], action: () => void) => {

                if (settled) return

                settled = true
                clearTimeout(timer)
                this.pending.delete(prompt.id)
                signal.removeEventListener("abort", cancel)

                try {
                    this.client.publish("lemo.prompt.release" satisfies PromptEvent, { id: prompt.id, reason })
                } finally {
                    action()
                }
            }

            const timer = setTimeout(() => settle("timeout", () => {
                reject(new Error(`No Client responded within ${this.timeout}ms`))
            }), this.timeout)

            const cancel = () => settle("cancelled", () => {
                reject(signal.reason ?? new Error("Task run stopped"))
            })

            this.pending.set(prompt.id, Object.freeze({
                prompt,
                resolve: answer => settle("answered", () => resolve(answer)),
                cancel
            }))

            signal.addEventListener("abort", cancel, { once: true })

            if (signal.aborted) {
                cancel()
                return
            }

            try {
                this.client.publish("lemo.prompt.open" satisfies PromptEvent, prompt)
            } catch (cause) {
                settle("cancelled", () => reject(cause))
            }
        })
    }

    private receive(value: unknown) {

        const parsed = response.safeParse(value)

        if (!parsed.success) return

        this.pending.get(parsed.data.id)?.resolve(parsed.data.content)
    }

    private restore(value: unknown) {

        if (!ready.safeParse(value).success) return

        for (const entry of this.pending.values()) {
            this.client.publish("lemo.prompt.open" satisfies PromptEvent, entry.prompt)
        }
    }
}
