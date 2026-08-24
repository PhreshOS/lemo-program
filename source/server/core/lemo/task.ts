import type LLMModel from "../llm/model"
import type LemoDatabase from "./database"
import type Executions from "./executions"
import type Operation from "./operation"

export type TaskStatus = "running" | "paused" | "cancelled" | "completed" | "failed"

export type TaskRequest = Readonly<{
    input: string
    model: LLMModel
}>

export type TaskSnapshot = Readonly<{
    id: string
    status: TaskStatus
    operations: readonly Operation[]
}>

/** A durable Task identity whose state is reconstructed from its operations. */
export default class Task {

    private constructor(
        public readonly id: string,
        private readonly database: LemoDatabase,
        private readonly executions: Executions
    ) {}

    public static async create(database: LemoDatabase, executions: Executions, request: TaskRequest) {

        if (!request.input.trim()) throw new Error("A Task requires input")

        const id = crypto.randomUUID()

        await database.createTask(id, {
            model: {
                provider: request.model.provider.identity,
                id: request.model.id
            },
            input: request.input
        })

        const task = new Task(id, database, executions)

        await executions.start(id, request.model)

        return task
    }

    public static async open(database: LemoDatabase, executions: Executions, id: string) {

        return await database.hasTask(id) ? new Task(id, database, executions) : null
    }

    /** Reconstructs the current Task status from its persisted operation chain. */
    public async status(): Promise<TaskStatus> {

        return taskStatus(await this.operations())
    }

    /** Loads the complete raw Task history in its global operation order. */
    public operations() {

        return this.database.operations(this.id)
    }

    /** Returns one internally consistent durable Task projection. */
    public async snapshot(): Promise<TaskSnapshot> {

        const operations = await this.operations()

        return Object.freeze({ id: this.id, status: taskStatus(operations), operations })
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

        const input = (await this.operations()).find(operation => operation.kind === "task.input")
        const payload = record(input?.payload)
        const model = record(payload?.model)
        const provider = typeof model?.provider === "string" ? model.provider : ""
        const id = typeof model?.id === "string" ? model.id : ""

        if (!provider || !id) throw new Error("A Task has no valid persisted LLM Model")

        return Object.freeze({ provider, id })
    }

    /** Resolves from persisted state or waits for this live Task execution. */
    public async result(): Promise<string> {

        const outcome = taskOutcome(await this.operations())

        if (outcome.type === "completed") return outcome.output

        if (outcome.type === "failed" || outcome.type === "cancelled") throw outcome.error

        return new Promise<string>((resolve, reject) => {

            const check = () => {

                void settle(this.operations(), resolve, reject, unsubscribe).catch(error => {

                    unsubscribe()
                    reject(error)
                })
            }

            const unsubscribe = this.subscribe(check)

            check()
        })
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
    operations: Promise<readonly Operation[]>,
    resolve: (output: string) => void,
    reject: (error: Error) => void,
    unsubscribe: () => void
) {

    const outcome = taskOutcome(await operations)

    if (outcome.type !== "completed" && outcome.type !== "failed" && outcome.type !== "cancelled") return

    unsubscribe()

    if (outcome.type === "completed") resolve(outcome.output)
    else reject(outcome.error)
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
