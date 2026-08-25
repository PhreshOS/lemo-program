import type LLMModel from "../llm/model"
import type LemoDatabase from "./database"
import type { TaskStatus, TaskSummary } from "./database"
import type Executions from "./executions"
import type Operation from "./operation"

export type { TaskStatus, TaskSummary } from "./database"

export type TaskRequest = Readonly<{
    input: string
    model: LLMModel
    command?: string
}>

export type TaskSnapshot = Readonly<{
    id: string
    status: TaskStatus
    operations: readonly Operation[]
    before: number | null
}>

export type TaskSource = Readonly<{
    type: "user" | "task"
    task?: string
    call?: string
}>

/** A durable Task identity whose state is reconstructed from its operations. */
export default class Task {

    private constructor(
        public readonly id: string,
        private readonly database: LemoDatabase,
        private readonly executions: Executions
    ) {}

    public static async create(
        database: LemoDatabase,
        executions: Executions,
        request: TaskRequest,
        source: TaskSource
    ) {

        if (!request.input.trim()) throw new Error("A Task requires input")

        const id = crypto.randomUUID()

        await database.createTask(id, {
            model: {
                provider: request.model.provider.identity,
                id: request.model.id
            },
            source,
            ...(request.command ? { command: request.command } : {}),
            input: request.input
        })

        const task = new Task(id, database, executions)

        await executions.start(id, request.model)

        return task
    }

    public static async open(database: LemoDatabase, executions: Executions, id: string) {

        return await database.task(id) ? new Task(id, database, executions) : null
    }

    /** Reconstructs the current Task status from its persisted operation chain. */
    public async status(): Promise<TaskStatus> {

        return (await this.summary()).status
    }

    /** Loads the latest bounded Task history in its global operation order. */
    public async operations() {

        return (await this.database.operations(this.id, {
            limit: taskSnapshotOperationLimit,
            order: "newest"
        })).operations
    }

    /** Returns one internally consistent bounded durable Task projection. */
    public async snapshot(): Promise<TaskSnapshot> {

        const page = await this.database.operations(this.id, {
            limit: taskSnapshotOperationLimit,
            order: "newest"
        })
        const input = await this.database.firstOperation(this.id, "task.input")
        const operations = input && !page.operations.some(operation => operation.id === input.id)
            ? Object.freeze([input, ...page.operations])
            : page.operations

        return Object.freeze({
            id: this.id,
            status: (await this.summary()).status,
            operations,
            before: page.next
        })
    }

    /** Returns the bounded summary used by Task lists. */
    public async summary(): Promise<TaskSummary> {

        const summary = await this.database.task(this.id)

        if (!summary) throw new Error(`Unknown Lemo Task "${this.id}"`)

        return summary
    }

    /** Returns an explicitly bounded page of this Task's chronology. */
    public operationsPage(limit: number, before?: number) {

        return this.database.operations(this.id, { limit, before, order: "newest" })
    }

    /** Observes only operations persisted after this subscription. */
    public subscribe(subscriber: (operation: Operation) => void) {

        return this.database.subscribe(this.id, subscriber)
    }

    public pause() {

        return this.executions.pause(this.id)
    }

    public cancel() {

        return this.executions.cancel(this.id)
    }

    public continue(model: LLMModel) {

        return this.executions.continue(this.id, model)
    }

    public async model() {

        const input = await this.database.firstOperation(this.id, "task.input")
        const payload = record(input?.payload)
        const model = record(payload?.model)
        const provider = typeof model?.provider === "string" ? model.provider : ""
        const id = typeof model?.id === "string" ? model.id : ""

        if (!provider || !id) throw new Error("A Task has no valid persisted LLM Model")

        return Object.freeze({ provider, id })
    }

    /** Resolves from persisted state or waits for this live Task execution. */
    public async result(): Promise<string> {

        const outcome = await this.outcome()

        if (outcome.type === "completed") return outcome.output

        if (outcome.type === "failed" || outcome.type === "cancelled") throw outcome.error

        return new Promise<string>((resolve, reject) => {

            const check = () => {

                void settle(this.outcome(), resolve, reject, unsubscribe).catch(error => {

                    unsubscribe()
                    reject(error)
                })
            }

            const unsubscribe = this.subscribe(check)

            check()
        })
    }

    private async outcome(): Promise<TaskOutcome> {

        const summary = await this.summary()

        if (summary.status === "running" || summary.status === "paused") {

            return { type: summary.status }
        }

        if (summary.status === "cancelled") {

            return { type: "cancelled", error: new Error("The Task was cancelled") }
        }

        const final = await this.database.latestOperation(
            this.id,
            summary.status === "completed" ? "task.completed" : "task.failed"
        )

        return taskOutcome(final ? [final] : [])
    }
}

export function taskStatus(operations: readonly Operation[]): TaskStatus {

    return taskOutcome(operations).type
}

function taskOutcome(operations: readonly Operation[]): TaskOutcome {

    const final = [...operations].reverse().find(operation => lifecycle.has(operation.kind))

    if (final?.kind === "task.completed") {

        const payload = record(final.payload)

        if (typeof payload?.output !== "string") throw new Error("A completed Task has an invalid output")

        return { type: "completed", output: payload.output }
    }

    if (final?.kind === "task.failed") {

        const payload = record(final.payload)

        const message = typeof payload?.message === "string" ? payload.message : "The Task failed"

        return { type: "failed", error: new Error(message) }
    }

    if (final?.kind === "task.cancelled") {

        return { type: "cancelled", error: new Error("The Task was cancelled") }
    }

    if (final?.kind === "task.paused") return { type: "paused" }

    return { type: "running" }
}

async function settle(
    outcome: Promise<TaskOutcome>,
    resolve: (output: string) => void,
    reject: (error: Error) => void,
    unsubscribe: () => void
) {

    const result = await outcome

    if (result.type !== "completed" && result.type !== "failed" && result.type !== "cancelled") return

    unsubscribe()

    if (result.type === "completed") resolve(result.output)
    else reject(result.error)
}

function record(value: unknown) {

    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null
}

type TaskOutcome = Readonly<{
    type: "running"
}> | Readonly<{
    type: "paused"
}> | Readonly<{
    type: "completed"
    output: string
}> | Readonly<{
    type: "failed"
    error: Error
}> | Readonly<{
    type: "cancelled"
    error: Error
}>

const lifecycle = new Set([
    "task.input",
    "task.run.started",
    "task.paused",
    "task.cancelled",
    "task.completed",
    "task.failed"
])

export const taskSnapshotOperationLimit = 256
