import type Operation from "@server/core/lemo/operation"
import type { OperationPage } from "@server/core/lemo/database"
import type { TaskSnapshot, TaskStatus } from "@server/core/lemo/task"
import { taskOperation } from "./operation"
import Tool, { type ToolControl } from "./tool"

export type TaskSubscriber = (task: Task) => void

export type TaskTimelineEvent = Readonly<{
    type: "input" | "output" | "failure"
    key: string
    content: string
}> | Readonly<{
    type: "tool"
    key: string
    tool: Tool
}>

export type TaskControl = Readonly<{
    pause(): Promise<void>
    cancel(): Promise<void>
    continue(): Promise<void>
    history(limit: number, before: number): Promise<unknown>
    respond(call: string, response: Parameters<ToolControl["respond"]>[0]): Promise<void>
}>

/** A local handle to one authoritative Server Task. */
export default class Task {

    private history: readonly Operation[]
    private readonly subscribers = new Set<TaskSubscriber>()
    private synchronizationError: Error | null = null
    private before: number | null
    private readonly toolRecords = new Map<string, Tool>()
    private timelineProjection: readonly TaskTimelineEvent[] = Object.freeze([])

    private constructor(
        public readonly id: string,
        operations: readonly Operation[],
        private readonly control: TaskControl
    ) {

        this.history = Object.freeze([...operations])
        this.before = null
        this.synchronizeTimeline()
    }

    public static from(snapshot: TaskSnapshot, control: TaskControl) {

        const task = new Task(snapshot.id, snapshot.operations, control)

        task.before = snapshot.before

        return task
    }

    public get status(): TaskStatus {

        return status(this.history)
    }

    public get error() {

        return this.synchronizationError
    }

    /** Stable snapshot replaced only after the authoritative Task changes. */
    public operations(): readonly Operation[] {

        return this.history
    }

    /** Model output and Tool calls in their authoritative order. */
    public timeline(): readonly TaskTimelineEvent[] {

        return this.timelineProjection
    }

    public subscribe(subscriber: TaskSubscriber) {

        this.subscribers.add(subscriber)

        return () => {

            this.subscribers.delete(subscriber)
        }
    }

    public async pause() {

        await this.control.pause()
    }

    public async cancel() {

        await this.control.cancel()
    }

    public async continue() {

        await this.control.continue()
    }

    public get hasEarlierOperations() {

        return this.before !== null && this.history.length < maximumRetainedOperations
    }

    public async loadEarlierOperations(limit = historyPageSize) {

        if (!this.hasEarlierOperations || this.before === null) return

        const page = operationPage(await this.control.history(
            Math.min(limit, maximumRetainedOperations - this.history.length),
            this.before
        ))

        this.before = page.next
        this.merge(page.operations)
    }

    public receive(value: unknown) {

        this.apply(taskOperation(value))
    }

    public synchronize(snapshot: TaskSnapshot) {

        if (snapshot.id !== this.id) throw new Error("The Server returned the wrong Lemo Task")

        const operations = new Map(this.history.map(operation => [operation.id, operation]))

        for (const operation of snapshot.operations) operations.set(operation.id, operation)

        this.history = retained([...operations.values()])
        this.before = snapshot.before
        this.synchronizationError = null
        this.changed()
    }

    public failSynchronization(cause: unknown) {

        this.synchronizationError = cause instanceof Error ? cause : new Error(String(cause))
        this.changed()
    }

    public get createdAt() {

        return this.history.find(operation => operation.kind === "task.input")?.createdAt
            ?? this.history[0]?.createdAt
            ?? 0
    }

    private apply(value: Operation) {

        if (value.task !== this.id || this.history.some(operation => operation.id === value.id)) return

        const previousFirst = this.history.find(operation => operation.kind !== "task.input")?.sequence

        this.history = retained([...this.history, value])

        const first = this.history.find(operation => operation.kind !== "task.input")?.sequence

        if (previousFirst !== undefined && first !== undefined && first > previousFirst) this.before = first

        this.changed()
    }

    private merge(values: readonly Operation[]) {

        const operations = new Map(this.history.map(operation => [operation.id, operation]))

        for (const operation of values) operations.set(operation.id, operation)

        this.history = retained([...operations.values()])
        this.synchronizationError = null
        this.changed()
    }

    private changed() {

        this.synchronizeTimeline()

        for (const subscriber of this.subscribers) subscriber(this)
    }

    private synchronizeTimeline() {

        const timeline: TaskTimelineEvent[] = []
        const tools = new Set<string>()
        let cycleHasText = false

        for (const operation of this.history) {
            const payload = object(operation.payload)

            if (operation.kind === "task.input") {
                const content = text(payload?.input)

                if (content) timeline.push({ type: "input", key: operation.id, content })
            }

            if (operation.kind === "cycle.started") cycleHasText = false

            if (operation.kind === "model.event" && payload?.type === "text") {
                const content = rawText(payload.content)

                if (!content) continue

                cycleHasText = true

                const previous = timeline.at(-1)

                if (previous?.type === "output") {
                    timeline[timeline.length - 1] = {
                        ...previous,
                        content: previous.content + content
                    }
                } else timeline.push({ type: "output", key: operation.id, content })
            }

            if (operation.kind === "model.message" && !cycleHasText) {
                const content = rawText(payload?.content)

                if (content) timeline.push({ type: "output", key: operation.id, content })
            }

            if (operation.kind === "task.failed") {
                timeline.push({
                    type: "failure",
                    key: operation.id,
                    content: text(payload?.message) || "The Task failed"
                })
            }

            if (operation.kind !== "model.event" || payload?.type !== "tool-call") continue

            const call = object(payload.call)
            const id = text(call?.id)
            const name = text(call?.name)

            if (!id || !name) continue

            let tool = this.toolRecords.get(id)

            if (!tool) {
                const control = Object.freeze({
                    respond: (response: Parameters<ToolControl["respond"]>[0]) => (
                        this.control.respond(id, response)
                    )
                })

                tool = new Tool(this.id, id, name, call?.input, control)

                this.toolRecords.set(id, tool)
            }

            tools.add(id)
            timeline.push({ type: "tool", key: operation.id, tool })
        }

        for (const tool of this.toolRecords.values()) tool.synchronize(this.history, this.status)

        for (const call of this.toolRecords.keys()) {
            if (!tools.has(call)) this.toolRecords.delete(call)
        }

        this.timelineProjection = Object.freeze(timeline)
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
    const before = value.before

    if (
        !id
        || (
            state !== "running"
            && state !== "paused"
            && state !== "cancelled"
            && state !== "completed"
            && state !== "failed"
        )
        || (before !== null && typeof before !== "number")
    ) {

        throw new Error("The Server returned an incomplete Lemo Task")
    }

    return Object.freeze({
        id,
        status: state,
        operations: Object.freeze(value.operations.map(taskOperation)),
        before
    })
}

function operationPage(value: unknown): OperationPage {

    if (!record(value) || !Array.isArray(value.operations)) {
        throw new Error("The Server returned an invalid Lemo operation page")
    }

    const next = value.next

    if (next !== null && typeof next !== "number") {
        throw new Error("The Server returned an invalid Lemo operation cursor")
    }

    return Object.freeze({
        operations: Object.freeze(value.operations.map(taskOperation)),
        next
    })
}

function retained(values: readonly Operation[]) {

    const ordered = [...values].sort((left, right) => left.sequence - right.sequence)
    const input = ordered.find(operation => operation.kind === "task.input")
    const recent = ordered.filter(operation => operation !== input).slice(-(maximumRetainedOperations - 1))

    return Object.freeze(input ? [input, ...recent] : recent)
}

function text(value: unknown) {

    return typeof value === "string" ? value.trim() : ""
}

function rawText(value: unknown) {

    return typeof value === "string" ? value : ""
}

function record(value: unknown): value is Record<string, unknown> {

    return typeof value === "object" && value !== null && !Array.isArray(value)
}

function object(value: unknown) {

    return record(value) ? value : null
}

const historyPageSize = 256
const maximumRetainedOperations = 2_048
