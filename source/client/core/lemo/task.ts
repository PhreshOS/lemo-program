import type Operation from "@server/core/lemo/operation"
import type { TaskSnapshot, TaskStatus } from "@server/core/lemo/task"

export type TaskSubscriber = (task: Task) => void

export type TaskChannel = Readonly<{
    snapshot: TaskSnapshot
    events: AsyncIterable<unknown>
    close(): void
}> & TaskControl

export type TaskControl = Readonly<{
    pause(): Promise<TaskSnapshot>
    cancel(): Promise<TaskSnapshot>
    continue(): Promise<TaskSnapshot>
}>

/** A local handle to one authoritative Server Task. */
export default class Task {

    private history: Operation[]
    private readonly subscribers = new Set<TaskSubscriber>()
    private synchronizationError: Error | null = null

    private constructor(
        public readonly id: string,
        operations: readonly Operation[],
        private readonly control: TaskControl
    ) {

        this.history = [...operations]
    }

    public static from(snapshot: TaskSnapshot, control: TaskControl) {

        return new Task(snapshot.id, snapshot.operations, control)
    }

    public static connect(channel: TaskChannel) {

        const task = Task.from(channel.snapshot, channel)

        if (task.status === "running" || task.status === "paused") void task.follow(channel)
        else channel.close()

        return task
    }

    public get status(): TaskStatus {

        return status(this.history)
    }

    public get error() {

        return this.synchronizationError
    }

    public operations(): readonly Operation[] {

        return this.history
    }

    public subscribe(subscriber: TaskSubscriber) {

        this.subscribers.add(subscriber)

        return () => {

            this.subscribers.delete(subscriber)
        }
    }

    public async pause() {

        this.synchronize(await this.control.pause())
    }

    public async cancel() {

        this.synchronize(await this.control.cancel())
    }

    public async continue() {

        this.synchronize(await this.control.continue())
    }

    private async follow(channel: TaskChannel) {

        try {
            for await (const value of channel.events) {

                this.apply(operation(value))

                if (terminal(this.status)) break
            }
        } catch (cause) {

            this.synchronizationError = cause instanceof Error ? cause : new Error(String(cause))

            this.changed()
        } finally {

            channel.close()
        }
    }

    private apply(value: Operation) {

        if (value.task !== this.id || this.history.some(operation => operation.id === value.id)) return

        this.history = [...this.history, value].sort((left, right) => left.sequence - right.sequence)

        this.changed()
    }

    private synchronize(snapshot: TaskSnapshot) {

        if (snapshot.id !== this.id) throw new Error("The Server returned the wrong Lemo Task")

        const operations = new Map(this.history.map(operation => [operation.id, operation]))

        for (const operation of snapshot.operations) operations.set(operation.id, operation)

        this.history = [...operations.values()].sort((left, right) => left.sequence - right.sequence)
        this.changed()
    }

    private changed() {

        for (const subscriber of this.subscribers) subscriber(this)
    }
}

function status(operations: readonly Operation[]): TaskStatus {

    const kind = [...operations].reverse().find(operation => lifecycle.has(operation.kind))?.kind

    if (kind === "task.completed") return "completed"

    if (kind === "task.failed") return "failed"

    if (kind === "task.cancelled") return "cancelled"

    if (kind === "task.paused") return "paused"

    return "running"
}

function terminal(status: TaskStatus) {

    return status === "completed" || status === "failed" || status === "cancelled"
}

const lifecycle = new Set([
    "task.input",
    "task.run.started",
    "task.paused",
    "task.cancelled",
    "task.completed",
    "task.failed"
])

export function taskSnapshot(value: unknown): TaskSnapshot {

    if (!record(value) || !Array.isArray(value.operations)) {

        throw new Error("The Server returned an invalid Lemo Task")
    }

    const id = text(value.id)

    const state = value.status

    if (
        !id
        || (
            state !== "running"
            && state !== "paused"
            && state !== "cancelled"
            && state !== "completed"
            && state !== "failed"
        )
    ) {

        throw new Error("The Server returned an incomplete Lemo Task")
    }

    return Object.freeze({
        id,
        status: state,
        operations: Object.freeze(value.operations.map(operation))
    })
}

function operation(value: unknown): Operation {

    if (!record(value)) throw new Error("The Server returned an invalid Lemo operation")

    const sequence = value.sequence

    const id = text(value.id)

    const task = nullableText(value.task)

    const parent = nullableText(value.parent)

    const kind = text(value.kind)

    const createdAt = value.createdAt

    if (
        typeof sequence !== "number"
        || !id
        || !task
        || (value.parent !== null && !parent)
        || !kind
        || typeof createdAt !== "number"
    ) {

        throw new Error("The Server returned an incomplete Lemo operation")
    }

    return Object.freeze({ sequence, id, task, parent, kind, payload: value.payload, createdAt })
}

function nullableText(value: unknown) {

    return value === null ? null : text(value)
}

function text(value: unknown) {

    return typeof value === "string" ? value.trim() : ""
}

function record(value: unknown): value is Record<string, unknown> {

    return typeof value === "object" && value !== null && !Array.isArray(value)
}
