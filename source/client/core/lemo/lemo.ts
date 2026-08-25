import type Operation from "@server/core/lemo/operation"
import type { TaskSnapshot } from "@server/core/lemo/task"
import type LLMModel from "../llm/model"
import Task, { taskSnapshot, type TaskControl } from "./task"

export type LemoObservation = Readonly<{
    snapshots: readonly TaskSnapshot[]
    events: AsyncIterable<unknown>
    close(): void
}>

export interface LemoSource {
    observe(): Promise<LemoObservation>
    create(input: string, model: LLMModel): Promise<TaskSnapshot>
    control(task: string): TaskControl
}

/** A local projection of Lemo's authoritative Server state. */
export default class Lemo {

    private readonly records = new Map<string, Task>()
    private readonly subscribers = new Set<() => void>()
    private initialization: Promise<readonly Task[]> | null = null
    private observation: LemoObservation | null = null
    private projection: readonly Task[] = Object.freeze([])

    public constructor(private readonly source: LemoSource) {}

    public async task(request: Readonly<{ input: string; model: LLMModel }>) {

        await this.start()

        return this.upsert(await this.source.create(request.input, request.model))
    }

    /** Starts the projection once and returns its current bounded snapshot. */
    public start(): Promise<readonly Task[]> {

        if (!this.initialization) this.initialization = this.initialize()

        return this.initialization
    }

    public tasks(): readonly Task[] {

        return this.projection
    }

    public subscribe(subscriber: () => void) {

        this.subscribers.add(subscriber)

        return () => { this.subscribers.delete(subscriber) }
    }

    public stop() {

        this.observation?.close()
        this.observation = null
        this.initialization = null
        this.records.clear()
        this.changed()
    }

    private async initialize(): Promise<readonly Task[]> {

        const observation = await this.source.observe()

        this.observation = observation

        try {
            for (const snapshot of observation.snapshots) this.upsert(snapshot, false)

            this.changed()
            void this.follow(observation)

            return this.projection
        } catch (error) {
            observation.close()
            this.observation = null
            this.initialization = null

            throw error
        }
    }

    private async follow(observation: LemoObservation) {

        try {
            for await (const value of observation.events) this.receive(value)
        } catch (cause) {
            for (const task of this.records.values()) task.failSynchronization(cause)
        } finally {
            if (this.observation === observation) {
                this.observation = null
                this.initialization = null
            }

            observation.close()
        }
    }

    private receive(value: unknown) {

        const operation = operationRecord(value)

        if (!operation.task) return

        const existing = this.records.get(operation.task)

        if (existing) existing.receive(operation)
        else {
            this.records.set(operation.task, Task.from({
                id: operation.task,
                status: operationStatus(operation),
                operations: Object.freeze([operation]),
                before: null
            }, this.source.control(operation.task)))
        }

        this.changed()
    }

    private upsert(snapshot: TaskSnapshot, changed = true) {

        const parsed = taskSnapshot(snapshot)
        const existing = this.records.get(parsed.id)

        if (existing) existing.synchronize(parsed)
        else this.records.set(parsed.id, Task.from(parsed, this.source.control(parsed.id)))

        if (changed) this.changed()

        return this.records.get(parsed.id)!
    }

    private changed() {

        const ordered = [...this.records.values()].sort((left, right) => (
            right.createdAt - left.createdAt || right.id.localeCompare(left.id)
        ))
        const active = ordered.filter(task => executing(task.status))
        const terminal = ordered.filter(task => !executing(task.status)).slice(0, recentTerminalTasks)
        const retained = new Set([...active, ...terminal].map(task => task.id))

        for (const identity of this.records.keys()) {
            if (!retained.has(identity)) this.records.delete(identity)
        }

        this.projection = Object.freeze([...active, ...terminal])

        for (const subscriber of this.subscribers) subscriber()
    }
}

function executing(status: Task["status"]) {

    return status === "running" || status === "paused"
}

function operationStatus(operation: Operation): TaskSnapshot["status"] {

    if (operation.kind === "task.completed") return "completed"

    if (operation.kind === "task.failed") return "failed"

    if (operation.kind === "task.cancelled") return "cancelled"

    if (operation.kind === "task.paused") return "paused"

    return "running"
}

function operationRecord(value: unknown): Operation {

    if (!record(value)) throw new Error("The Server published an invalid Lemo operation")

    const sequence = value.sequence
    const id = text(value.id)
    const task = nullableText(value.task)
    const parent = nullableText(value.parent)
    const kind = text(value.kind)
    const createdAt = value.createdAt

    if (
        typeof sequence !== "number"
        || !id
        || (value.task !== null && !task)
        || (value.parent !== null && !parent)
        || !kind
        || typeof createdAt !== "number"
    ) throw new Error("The Server published an incomplete Lemo operation")

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

const recentTerminalTasks = 20
