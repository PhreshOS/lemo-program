import type LLMModel from "../llm/model"
import Cycle from "./cycle"
import type LemoDatabase from "./database"
import type Memory from "./memory"
import type Operation from "./operation"
import type Runtime from "./runtime/runtime"
import { taskStatus } from "./task"

export type TaskRun = Readonly<{
    task: string
    id: string
    signal: AbortSignal
    append(kind: string, payload: unknown): Promise<Operation>
}>

type Active = {
    readonly id: string
    readonly controller: AbortController
    settled: Promise<void>
}

/** Lemo's disposable coordinator for active Task runs. */
export default class Executions {

    private readonly active = new Map<string, Active>()
    private readonly transitions = new Map<string, Promise<void>>()

    public constructor(
        private readonly database: LemoDatabase,
        private readonly memory: Memory,
        private readonly runtime: Runtime
    ) {}

    /** Converts work left by a previous Process into a durable paused state. */
    public async recover() {

        for (const task of await this.database.tasks()) {

            const operations = await this.database.operations(task)

            if (taskStatus(operations) !== "running") continue

            await this.database.appendToTask(task, "task.paused", {
                run: currentRun(operations),
                reason: "interrupted"
            })
        }
    }

    public start(task: string, model: LLMModel) {

        return this.exclusive(task, async () => {

            const operations = await this.database.operations(task)

            if (taskStatus(operations) !== "running") throw new Error("Only a running new Task can start")
            if (currentRun(operations)) throw new Error("This Task already has a run")

            await this.begin(task, model, "created")
        })
    }

    public pause(task: string) {

        return this.exclusive(task, async () => {

            const status = taskStatus(await this.database.operations(task))

            if (status === "paused") return
            if (status !== "running") throw new Error(`A ${status} Task cannot be paused`)

            await this.stopActive(task, "Task paused")

            const operations = await this.database.operations(task)

            if (taskStatus(operations) !== "running") return

            await this.database.appendToTask(task, "task.paused", {
                run: currentRun(operations),
                reason: "requested"
            })
        })
    }

    public cancel(task: string) {

        return this.exclusive(task, async () => {

            const status = taskStatus(await this.database.operations(task))

            if (status === "cancelled") return
            if (status === "completed" || status === "failed") {
                throw new Error(`A ${status} Task cannot be cancelled`)
            }

            await this.stopActive(task, "Task cancelled")

            const operations = await this.database.operations(task)
            const settled = taskStatus(operations)

            if (settled === "completed" || settled === "failed") return

            await this.database.appendToTask(task, "task.cancelled", {
                run: currentRun(operations),
                reason: "requested"
            })
        })
    }

    public continue(task: string, model: LLMModel) {

        return this.exclusive(task, async () => {

            const operations = await this.database.operations(task)

            if (taskStatus(operations) !== "paused") throw new Error("Only a paused Task can continue")

            await this.begin(task, model, "continued")
        })
    }

    private async begin(task: string, model: LLMModel, reason: "created" | "continued") {

        const run = crypto.randomUUID()

        await this.database.appendToTask(task, "task.run.started", {
            run,
            reason,
            model: { provider: model.provider.identity, id: model.id }
        })

        const controller = new AbortController()
        const active: Active = { id: run, controller, settled: Promise.resolve() }

        this.active.set(task, active)

        active.settled = this.execute(this.run(task, active), model).finally(() => {

            if (this.active.get(task) === active) this.active.delete(task)
        })

        void active.settled.catch(() => {})
    }

    private run(task: string, active: Active): TaskRun {

        return Object.freeze({
            task,
            id: active.id,
            signal: active.controller.signal,
            append: (kind: string, payload: unknown) => {

                this.assertActive(task, active)

                return this.database.appendToTask(task, kind, payload)
            }
        })
    }

    private async execute(run: TaskRun, model: LLMModel) {

        try {
            while (true) {

                assertRunning(run.signal)

                const cycle = await Cycle.run(
                    this.database,
                    this.memory,
                    run,
                    model,
                    await this.runtime.definitions(this.database, run.task)
                )

                assertRunning(run.signal)

                if (cycle.toolCalls.length) {

                    await this.runtime.execute(run, cycle.toolCalls)

                    continue
                }

                await run.append("task.completed", { run: run.id, output: cycle.output })

                return
            }
        } catch (cause) {

            if (run.signal.aborted) return

            const error = cause instanceof Error ? cause : new Error(String(cause))

            try {
                await run.append("task.failed", {
                    run: run.id,
                    name: error.name,
                    message: error.message,
                    stack: error.stack ?? null
                })
            } catch (recordingCause) {

                if (run.signal.aborted) return

                throw new AggregateError(
                    [error, recordingCause],
                    "The Task failed and Lemo could not record its failure"
                )
            }
        }
    }

    private async stopActive(task: string, reason: string) {

        const active = this.active.get(task)

        if (!active) return

        active.controller.abort(new Error(reason))

        await active.settled

        await this.recordInterruptedTools(task, active.id, reason)
    }

    private async recordInterruptedTools(task: string, run: string, reason: string) {

        const operations = await this.database.operations(task)
        const began = operations.findLastIndex(operation => {

            if (operation.kind !== "task.run.started") return false

            return record(operation.payload)?.run === run
        })

        if (began < 0) return

        const current = operations.slice(began)
        const completed = new Set(current.flatMap(operation => {

            if (operation.kind !== "tool.result") return []

            const call = record(operation.payload)?.call

            return typeof call === "string" ? [call] : []
        }))

        for (const operation of current) {

            if (operation.kind !== "model.message") continue

            const calls = record(operation.payload)?.toolCalls

            if (!Array.isArray(calls)) continue

            for (const value of calls) {

                const call = record(value)
                const id = typeof call?.id === "string" ? call.id : ""
                const name = typeof call?.name === "string" ? call.name : ""

                if (!id || !name || completed.has(id)) continue

                await this.database.appendToTask(task, "tool.result", {
                    call: id,
                    name,
                    ok: false,
                    error: `${reason} before the Tool completed`
                })

                completed.add(id)
            }
        }
    }

    private assertActive(task: string, active: Active) {

        assertRunning(active.controller.signal)

        if (this.active.get(task) !== active) throw new Error("This Task run is no longer active")
    }

    private async exclusive<Result>(task: string, transition: () => Promise<Result>): Promise<Result> {

        const previous = this.transitions.get(task) ?? Promise.resolve()

        let release!: () => void

        const current = new Promise<void>(resolve => { release = resolve })

        this.transitions.set(task, current)

        await previous

        try {
            return await transition()
        } finally {
            release()

            if (this.transitions.get(task) === current) this.transitions.delete(task)
        }
    }
}

export function assertRunning(signal: AbortSignal): void {

    if (signal.aborted) throw signal.reason ?? new Error("Task run stopped")
}

export function waitForRun<Value>(operation: Promise<Value>, signal: AbortSignal): Promise<Value> {

    assertRunning(signal)

    return new Promise<Value>((resolve, reject) => {

        const abort = () => reject(signal.reason ?? new Error("Task run stopped"))

        signal.addEventListener("abort", abort, { once: true })

        operation.then(
            value => {
                signal.removeEventListener("abort", abort)
                resolve(value)
            },
            error => {
                signal.removeEventListener("abort", abort)
                reject(error)
            }
        )
    })
}

function currentRun(operations: readonly Operation[]) {

    for (let index = operations.length - 1; index >= 0; index--) {

        const operation = operations[index]

        if (operation?.kind !== "task.run.started") continue

        const payload = record(operation.payload)

        return typeof payload?.run === "string" ? payload.run : null
    }

    return null
}

function record(value: unknown) {

    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null
}
