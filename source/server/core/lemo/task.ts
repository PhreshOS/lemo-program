import type LLMModel from "../llm/model"
import Cycle from "./cycle"
import type LemoDatabase from "./database"
import type Memory from "./memory"
import type Operation from "./operation"
import type Runtime from "./runtime/runtime"

export type TaskStatus = "running" | "completed" | "failed"

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

    private readonly completion: Promise<string>
    private resolve!: (output: string) => void
    private reject!: (error: Error) => void

    private constructor(
        public readonly id: string,
        private readonly database: LemoDatabase,
        private readonly memory: Memory,
        private readonly runtime: Runtime
    ) {

        this.completion = new Promise((resolve, reject) => {

            this.resolve = resolve

            this.reject = reject
        })

        void this.completion.catch(() => {})
    }

    public static async create(database: LemoDatabase, memory: Memory, runtime: Runtime, request: TaskRequest) {

        if (!request.input.trim()) throw new Error("A Task requires input")

        const id = crypto.randomUUID()

        await database.createTask(id, {
            model: {
                provider: request.model.provider.identity,
                id: request.model.id
            },
            input: request.input
        })

        const task = new Task(id, database, memory, runtime)

        task.start(request.model)

        return task
    }

    public static async open(database: LemoDatabase, memory: Memory, runtime: Runtime, id: string) {

        return await database.hasTask(id) ? new Task(id, database, memory, runtime) : null
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

    /** Resolves from persisted state or waits for this live Task execution. */
    public async result(): Promise<string> {

        const outcome = taskOutcome(await this.operations())

        if (outcome.type === "completed") return outcome.output

        if (outcome.type === "failed") throw outcome.error

        return this.completion
    }

    private start(model: LLMModel) {

        void this.execute(model)
    }

    private async execute(model: LLMModel) {

        try {
            while (true) {

                const cycle = await Cycle.run(
                    this.database,
                    this.memory,
                    this.id,
                    model,
                    await this.runtime.definitions(this.database, this.id)
                )

                if (cycle.toolCalls.length) {

                    await this.runtime.execute(this.database, this.id, cycle.toolCalls)

                    continue
                }

                await this.database.appendToTask(this.id, "task.completed", { output: cycle.output })

                this.resolve(cycle.output)

                return
            }
        } catch (cause) {

            const error = cause instanceof Error ? cause : new Error(String(cause))

            try {
                await this.database.appendToTask(this.id, "task.failed", errorPayload(error))
            } catch (recordingCause) {

                const recordingError = recordingCause instanceof Error
                    ? recordingCause
                    : new Error(String(recordingCause))

                this.reject(new AggregateError(
                    [error, recordingError],
                    "The Task failed and Lemo could not record its failure"
                ))

                return
            }

            this.reject(error)
        }
    }
}

function taskStatus(operations: readonly Operation[]): TaskStatus {

    return taskOutcome(operations).type
}

function taskOutcome(operations: readonly Operation[]): TaskOutcome {

    const final = operations.at(-1)

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

    return { type: "running" }
}

function errorPayload(error: Error) {

    return {
        name: error.name,
        message: error.message,
        stack: error.stack ?? null
    }
}

function record(value: unknown) {

    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null
}

type TaskOutcome = Readonly<{
    type: "running"
}> | Readonly<{
    type: "completed"
    output: string
}> | Readonly<{
    type: "failed"
    error: Error
}>
