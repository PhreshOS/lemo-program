import LemoDatabase, { type LemoDatabaseSource } from "./database"
import type { TaskListRequest, TaskPage } from "./database"
import type ClientChannel from "../client-channel"
import Memory from "./memory"
import Task, { type TaskRequest, type TaskSource } from "./task"
import Runtime from "./runtime/runtime"
import type {
    TaskEvent,
    TaskEventName,
    TaskWaitRequest,
    ToolContext,
    ToolTasks
} from "./runtime/tool"
import Executions from "./executions"
import type LLMModel from "../llm/model"
import type Operation from "./operation"

/** The one enduring Lemo entity. */
export default class Lemo {

    private readonly executions: Executions
    private readonly runtime: Runtime
    private creation = Promise.resolve()

    private constructor(private readonly database: LemoDatabase, client: ClientChannel) {

        const memory = new Memory(database)

        this.runtime = new Runtime(
            database,
            memory,
            client,
            (invocation, model) => this.toolTasks(invocation, model)
        )

        this.executions = new Executions(
            database,
            memory,
            this.runtime,
            maximumExecutingTasks
        )
    }

    public static async wakeUp(database: LemoDatabaseSource, client: ClientChannel): Promise<Lemo> {

        const opened = await LemoDatabase.open(database)
        const lemo = new Lemo(opened, client)

        await lemo.executions.recover()

        return lemo
    }

    /** Starts one independent Task without waiting for its execution. */
    public task(request: TaskRequest): Promise<Task> {

        return this.createTask(request, { type: "user" })
    }

    /** Reconstructs an existing Task handle from its durable identity. */
    public findTask(id: string): Promise<Task | null> {

        return Task.open(this.database, this.executions, id)
    }

    /** Returns the bounded Task projection initially needed by a Client. */
    public async clientTasks(): Promise<readonly Task[]> {

        const active = await this.database.tasks({
            limit: maximumExecutingTasks,
            statuses: ["running", "paused"],
            order: "newest"
        })
        const recent = await this.database.tasks({
            limit: recentClientTasks,
            statuses: ["completed", "cancelled"],
            order: "newest"
        })

        if (active.next) throw new Error(`Lemo has more than ${maximumExecutingTasks} executing Tasks`)

        return Object.freeze(await Promise.all(
            [...active.tasks, ...recent.tasks].map(summary => this.requireTask(summary.id))
        ))
    }

    public tasks(request: TaskListRequest): Promise<TaskPage> {

        return this.database.tasks(request)
    }

    private createTask(request: TaskRequest, source: TaskSource): Promise<Task> {

        return this.serializeCreation(async () => {

            if (await this.database.executingTasks() >= maximumExecutingTasks) {

                throw new Error(`Lemo can execute at most ${maximumExecutingTasks} running or paused Tasks`)
            }

            return Task.create(this.database, this.executions, request, source)
        })
    }

    private toolTasks(invocation: ToolContext["invocation"], model: LLMModel): ToolTasks {

        return Object.freeze({
            list: request => this.tasks(request),
            read: async (identity, limit, before) => {

                const task = await this.requireTask(identity)

                return Object.freeze({
                    task: await task.summary(),
                    operations: await task.operationsPage(limit, before)
                })
            },
            create: async input => (
                await this.createTask(
                    { input, model },
                    { type: "task", task: invocation.task, call: invocation.call }
                )
            ).summary(),
            pause: async identity => {

                this.assertOtherTask(invocation.task, identity, "pause")

                const task = await this.requireTask(identity)

                await task.pause()

                return task.summary()
            },
            continue: async identity => {

                const task = await this.requireTask(identity)

                await task.continue(model)

                return task.summary()
            },
            cancel: async identity => {

                this.assertOtherTask(invocation.task, identity, "cancel")

                const task = await this.requireTask(identity)

                await task.cancel()

                return task.summary()
            },
            wait: request => this.waitTask(request, invocation.signal)
        })
    }

    private async requireTask(identity: string) {

        const task = await this.findTask(identity)

        if (!task) throw new Error(`Unknown Lemo Task "${identity}"`)

        return task
    }

    private waitTask(request: TaskWaitRequest, signal: AbortSignal): Promise<TaskEvent> {

        const tasks = request.tasks ? new Set(request.tasks) : null
        const events = new Set<TaskEventName>(request.events ?? taskEvents)
        const timeout = request.timeout ?? defaultTaskWaitTimeout

        return new Promise<TaskEvent>((resolve, reject) => {

            let settled = false

            const finish = (result: TaskEvent | Error) => {

                if (settled) return

                settled = true
                clearTimeout(timer)
                signal.removeEventListener("abort", abort)
                unsubscribe()

                if (result instanceof Error) reject(result)
                else resolve(result)
            }
            const receive = (operation: Operation) => {

                const event = taskEvent(operation)

                if (!event || !events.has(event.event)) return
                if (tasks && !tasks.has(event.task)) return

                finish(event)
            }
            const abort = () => finish(signal.reason instanceof Error
                ? signal.reason
                : new Error("Task waiting was cancelled"))
            const unsubscribe = this.database.subscribeOperations(receive)
            const timer = setTimeout(
                () => finish(new Error(`Task event promise timeout ${timeout}ms`)),
                timeout
            )

            signal.addEventListener("abort", abort, { once: true })

            if (signal.aborted) abort()

            if (tasks) {

                void this.existingTaskEvent([...tasks], events).then(
                    event => { if (event) finish(event) },
                    error => finish(error instanceof Error ? error : new Error(String(error)))
                )
            }
        })
    }

    private async existingTaskEvent(
        tasks: readonly string[],
        events: ReadonlySet<TaskEventName>
    ): Promise<TaskEvent | null> {

        const found = await Promise.all(tasks.map(async identity => {

            const summary = await this.database.task(identity)

            if (!summary) throw new Error(`Unknown Lemo Task "${identity}"`)

            const kind = summary.status === "running"
                ? "task.run.started"
                : `task.${summary.status}`
            const operation = await this.database.latestOperation(identity, kind)
                ?? await this.database.firstOperation(identity, "task.input")
            const event = operation ? taskEvent(operation) : null

            return event && events.has(event.event) ? event : null
        }))

        return found
            .filter((event): event is TaskEvent => event !== null)
            .sort((left, right) => right.createdAt - left.createdAt)[0] ?? null
    }

    private assertOtherTask(current: string, target: string, action: "pause" | "cancel") {

        if (current === target) {

            throw new Error(`A running Task cannot ${action} itself from its own Tool invocation`)
        }
    }

    private async serializeCreation<Result>(operation: () => Promise<Result>): Promise<Result> {

        const previous = this.creation
        let release!: () => void
        const current = new Promise<void>(resolve => { release = resolve })

        this.creation = current

        await previous

        try {
            return await operation()
        } finally {
            release()

            if (this.creation === current) this.creation = Promise.resolve()
        }
    }
}

function taskEvent(operation: Operation): TaskEvent | null {

    if (!operation.task) return null

    const event = operationEvent(operation)

    return event ? Object.freeze({
        task: operation.task,
        event,
        operation: operation.id,
        createdAt: operation.createdAt
    }) : null
}

function operationEvent(operation: Operation): TaskEventName | null {

    if (operation.kind === "task.input") return "created"

    if (operation.kind === "task.paused") return "paused"

    if (operation.kind === "task.completed") return "completed"

    if (operation.kind === "task.failed") return "failed"

    if (operation.kind === "task.cancelled") return "cancelled"

    if (operation.kind !== "task.run.started") return null

    return record(operation.payload)?.reason === "continued" ? "continued" : "running"
}

function record(value: unknown) {

    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null
}

export const maximumExecutingTasks = 10

const recentClientTasks = 20
const defaultTaskWaitTimeout = 10_000
const taskEvents: readonly TaskEventName[] = [
    "created",
    "running",
    "paused",
    "continued",
    "completed",
    "failed",
    "cancelled"
]
