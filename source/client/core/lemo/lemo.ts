import type Operation from "@server/core/lemo/operation"
import type { TaskSnapshot } from "@server/core/lemo/task"
import type LLMModel from "../llm/model"
import Task, { taskSnapshot, type TaskControl } from "./task"
import operation from "./operation"

export type LemoObservation = Readonly<{
    snapshots: readonly TaskSnapshot[]
    events: AsyncIterable<unknown>
    close(): void
}>

export interface LemoSource {
    observe(): Promise<LemoObservation>
    create(command: string, input: string, model: LLMModel): Promise<void>
    control(task: string): TaskControl
}

/** A local projection of Lemo's authoritative Server state. */
export default class Lemo {

    private readonly records = new Map<string, Task>()
    private readonly subscribers = new Set<() => void>()
    private initialization: Promise<readonly Task[]> | null = null
    private observation: LemoObservation | null = null
    private projection: readonly Task[] = Object.freeze([])
    private readonly creations = new Map<string, PendingTask>()
    private lifecycle = 0

    public constructor(private readonly source: LemoSource) {}

    public async task(request: Readonly<{ input: string; model: LLMModel }>) {

        await this.start()

        const command = crypto.randomUUID()
        let resolve!: (task: Task) => void
        let reject!: (cause: unknown) => void
        const publication = new Promise<Task>((solve, fail) => {

            resolve = solve
            reject = fail
        })

        this.creations.set(command, { resolve, reject })

        try {
            await this.source.create(command, request.input, request.model)

            return await publication
        } catch (cause) {
            this.creations.delete(command)

            throw cause
        }
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

        this.lifecycle++
        this.observation?.close()
        this.observation = null
        this.initialization = null
        this.records.clear()
        this.rejectCreations(new Error("Lemo stopped before the Task was published"))
        this.changed()
    }

    private async initialize(): Promise<readonly Task[]> {

        const lifecycle = this.lifecycle
        const observation = await this.source.observe()

        if (lifecycle !== this.lifecycle) {
            observation.close()

            throw new Error("Lemo stopped while its projection was opening")
        }

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
            this.rejectCreations(cause)
        } finally {
            if (this.observation === observation) {
                this.observation = null
                this.initialization = null
                this.rejectCreations(new Error("The Lemo operation stream closed"))
            }

            observation.close()
        }
    }

    private receive(value: unknown) {

        const received = operation(value)

        if (!received.task) return

        const existing = this.records.get(received.task)

        let task: Task

        if (existing) {
            existing.receive(received)
            task = existing
        }
        else {
            task = Task.from({
                id: received.task,
                status: operationStatus(received),
                operations: Object.freeze([received]),
                before: null
            }, this.source.control(received.task))
            this.records.set(received.task, task)
        }

        const command = received.kind === "task.input" ? taskCommand(received.payload) : null
        const pending = command ? this.creations.get(command) : null

        if (command && pending) {
            this.creations.delete(command)
            pending.resolve(task)
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

    private rejectCreations(cause: unknown) {

        for (const pending of this.creations.values()) pending.reject(cause)

        this.creations.clear()
    }
}

type PendingTask = Readonly<{
    resolve(task: Task): void
    reject(cause: unknown): void
}>

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

function taskCommand(value: unknown) {

    return record(value) ? text(value.command) || null : null
}

function text(value: unknown) {

    return typeof value === "string" ? value.trim() : ""
}

function record(value: unknown): value is Record<string, unknown> {

    return typeof value === "object" && value !== null && !Array.isArray(value)
}

const recentTerminalTasks = 20
