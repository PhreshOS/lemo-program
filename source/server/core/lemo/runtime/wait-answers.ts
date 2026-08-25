import type {
    PromptEvent,
    PromptRecord,
    PromptRelease
} from "@client/core/prompts/contract"
import type ClientChannel from "@server/core/client-channel"
import { z } from "zod"
import {
    promptValueSchema,
    validatePromptAnswer,
    type PromptAnswer,
    type WaitAnswerRequest
} from "./prompt-contract"

const response = z.discriminatedUnion("type", [
    z.strictObject({
        id: z.string().trim().min(1),
        type: z.literal("submitted"),
        values: z.record(z.string().trim().min(1).max(64), promptValueSchema)
    }),
    z.strictObject({
        id: z.string().trim().min(1),
        type: z.literal("cancelled")
    }),
    z.strictObject({
        id: z.string().trim().min(1),
        type: z.literal("failed"),
        error: z.string().trim().min(1).max(1_000)
    })
])

const defaultCapacity = 4
const defaultTimeout = 2 * 60 * 1_000

type Pending = Readonly<{
    prompt: PromptRecord
    resolve(answer: PromptAnswer, reason?: PromptRelease["reason"]): void
    reject(error: Error, reason?: PromptRelease["reason"]): void
    cancel(): void
}>

export type WaitAnswerContext = Readonly<{
    task: string
    call: string
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
        client.subscribe("lemo.prompt.ready" satisfies PromptEvent, () => this.restore())
    }

    public wait(context: WaitAnswerContext, request: WaitAnswerRequest, signal: AbortSignal): Promise<PromptAnswer> {

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
            request,
            createdAt,
            expiresAt: createdAt + this.timeout
        })

        return new Promise<PromptAnswer>((resolve, reject) => {

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
                resolve: (answer, reason = "answered") => settle(reason, () => resolve(answer)),
                reject: (error, reason = "failed") => settle(reason, () => reject(error)),
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

        if (!parsed.success) {

            const invalid = record(value)
            const id = typeof invalid?.id === "string" ? invalid.id : ""

            if (id && this.pending.has(id)) this.rejectResponse(id, "The Client returned an invalid Prompt response")

            return
        }

        const pending = this.pending.get(parsed.data.id)

        if (!pending) return

        if (parsed.data.type === "failed") {
            pending.reject(new Error(parsed.data.error))
            return
        }

        if (parsed.data.type === "cancelled") {
            pending.resolve({ type: "cancelled" }, "cancelled")
            return
        }

        try {
            pending.resolve(validatePromptAnswer(pending.prompt.request, {
                type: "submitted",
                values: parsed.data.values
            }))
        } catch (cause) {
            this.rejectResponse(parsed.data.id, cause instanceof Error ? cause.message : String(cause))
        }
    }

    private rejectResponse(id: string, error: string) {

        this.client.publish("lemo.prompt.invalid" satisfies PromptEvent, { id, error })
    }

    private restore() {

        for (const entry of this.pending.values()) {
            this.client.publish("lemo.prompt.open" satisfies PromptEvent, entry.prompt)
        }
    }
}

function record(value: unknown) {

    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null
}
