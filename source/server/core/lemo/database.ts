import type { ProgramSql } from "@phreshos/core"
import type { DatabaseSync, SQLInputValue } from "node:sqlite"
import schema from "./schema.sql?raw"
import type Operation from "./operation"
import type { OperationInput } from "./operation"

/** Lemo's internal raw operation database. */
export default class LemoDatabase {

    private readonly subscribers = new Map<string, Set<OperationSubscriber>>()
    private readonly operationSubscribers = new Set<OperationSubscriber>()

    private constructor(private readonly source: LemoDatabaseSource) {}

    public static async open(source: LemoDatabaseSource) {

        const database = new LemoDatabase(source)

        await database.execute("PRAGMA foreign_keys = ON")

        for (const statement of statements(schema)) await database.execute(statement)

        return database
    }

    public async createTask(id: string, payload: unknown): Promise<Operation> {

        const createdAt = Date.now()

        await this.run(
            "INSERT INTO tasks (id, created_at) VALUES (?, ?)",
            [id, createdAt]
        )

        return this.append({
            task: id,
            parent: null,
            kind: "task.input",
            payload
        })
    }

    /** Returns one bounded, searchable page of durable Task summaries. */
    public async tasks(request: TaskListRequest): Promise<TaskPage> {

        const limit = taskLimit(request.limit)
        const order = request.order ?? "newest"
        const cursor = request.cursor ?? null
        const conditions: string[] = []
        const values: SQLInputValue[] = []

        if (request.statuses?.length) {

            conditions.push(`status IN (${request.statuses.map(() => "?").join(", ")})`)
            values.push(...request.statuses)
        }

        const search = request.search?.trim().toLocaleLowerCase()

        if (search) {

            conditions.push("LOWER(input) LIKE ? ESCAPE '\\'")
            values.push(`%${like(search)}%`)
        }

        if (request.sourceTask) {

            conditions.push("source_task = ?")
            values.push(request.sourceTask)
        }

        if (request.createdAfter !== undefined) {

            conditions.push("created_at >= ?")
            values.push(request.createdAfter)
        }

        if (request.createdBefore !== undefined) {

            conditions.push("created_at < ?")
            values.push(request.createdBefore)
        }

        if (cursor) {

            const comparison = order === "newest" ? "<" : ">"

            conditions.push(`(created_at, id) ${comparison} (?, ?)`)
            values.push(cursor.createdAt, cursor.id)
        }

        values.push(limit + 1)

        const rows = await this.query<TaskSummaryRow>(`
            ${taskStates}
            SELECT id, status, input, source, source_task, source_call, created_at, updated_at
            FROM task_states
            ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
            ORDER BY created_at ${order === "newest" ? "DESC" : "ASC"}, id ${order === "newest" ? "DESC" : "ASC"}
            LIMIT ?
        `, values)

        const more = rows.length > limit
        const selected = rows.slice(0, limit).map(taskSummary)
        const last = selected.at(-1)

        return Object.freeze({
            tasks: Object.freeze(selected),
            next: more && last ? Object.freeze({ id: last.id, createdAt: last.createdAt }) : null
        })
    }

    /** Returns the current summary of one Task without loading its history. */
    public async task(id: string): Promise<TaskSummary | null> {

        const rows = await this.query<TaskSummaryRow>(`
            ${taskStates}
            SELECT id, status, input, source, source_task, source_call, created_at, updated_at
            FROM task_states
            WHERE id = ?
            LIMIT 1
        `, [id])

        return rows[0] ? taskSummary(rows[0]) : null
    }

    /** Counts current execution capacity without loading Task entities. */
    public async executingTasks(): Promise<number> {

        const rows = await this.query<{ total: number }>(`
            ${taskStates}
            SELECT COUNT(*) AS total
            FROM task_states
            WHERE status IN ('running', 'paused')
        `, [])

        return rows[0]?.total ?? 0
    }

    /** Persists one directed message only while its receiving Task is running. */
    public async sendMessage(input: TaskMessageInput): Promise<TaskMessage> {

        if (!input.content.trim()) throw new Error("A Task message requires content")
        if (!input.sourceCall.trim()) throw new Error("A Task message requires its source call")
        if (input.sourceTask === input.targetTask) throw new Error("A Task cannot send a message to itself")

        const id = crypto.randomUUID()
        const createdAt = Date.now()
        const rows = await this.query<TaskMessageRow>(`
            ${taskStates}
            INSERT INTO messages (
                id,
                source_task_id,
                source_call,
                target_task_id,
                content,
                created_at,
                delivered_at
            )
            SELECT ?, ?, ?, ?, ?, ?, NULL
            WHERE EXISTS (
                SELECT 1
                FROM task_states
                WHERE id = ? AND status = 'running'
            )
            RETURNING sequence, id, source_task_id, source_call, target_task_id, content, created_at, delivered_at
        `, [
            id,
            input.sourceTask,
            input.sourceCall,
            input.targetTask,
            input.content,
            createdAt,
            input.targetTask
        ])

        const stored = rows[0]

        if (stored) return taskMessage(stored)

        const target = await this.task(input.targetTask)

        if (!target) throw new Error(`Unknown Lemo Task "${input.targetTask}"`)

        throw new Error(`A ${target.status} Task cannot receive messages`)
    }

    /** Delivers only the newest bounded message window for one Model cycle. */
    public async contextMessages(task: string): Promise<readonly TaskMessage[]> {

        const rows = await this.query<TaskMessageRow>(`
            SELECT sequence, id, source_task_id, source_call, target_task_id, content, created_at, delivered_at
            FROM messages
            WHERE target_task_id = ?
            ORDER BY sequence DESC
            LIMIT ?
        `, [task, maximumContextMessages])
        const pending = rows.filter(row => row.delivered_at === null)

        if (pending.length) {

            await this.run(`
                UPDATE messages
                SET delivered_at = ?
                WHERE delivered_at IS NULL
                  AND id IN (${pending.map(() => "?").join(", ")})
            `, [Date.now(), ...pending.map(message => message.id)])
        }

        return Object.freeze(rows
            .sort((left, right) => left.sequence - right.sequence)
            .map(taskMessage))
    }

    /** Observes future persisted operations without retaining history. */
    public subscribe(task: string, subscriber: OperationSubscriber) {

        let subscribers = this.subscribers.get(task)

        if (!subscribers) {

            subscribers = new Set()

            this.subscribers.set(task, subscribers)
        }

        subscribers.add(subscriber)

        return () => {

            subscribers.delete(subscriber)

            if (!subscribers.size) this.subscribers.delete(task)
        }
    }

    /** Observes future persisted operations across Tasks without retaining history. */
    public subscribeOperations(subscriber: OperationSubscriber) {

        this.operationSubscribers.add(subscriber)

        return () => { this.operationSubscribers.delete(subscriber) }
    }

    /** Returns a bounded operation page in authoritative order. */
    public async operations(task: string, request: OperationPageRequest): Promise<OperationPage> {

        const limit = operationLimit(request.limit)
        const conditions = ["task_id = ?"]
        const values: SQLInputValue[] = [task]

        if (request.before !== undefined) {

            conditions.push("sequence < ?")
            values.push(request.before)
        }

        if (request.after !== undefined) {

            conditions.push("sequence > ?")
            values.push(request.after)
        }

        values.push(limit + 1)

        const rows = await this.query<OperationRow>(`
            SELECT sequence, id, task_id, parent_id, kind, payload, created_at
            FROM operations
            WHERE ${conditions.join(" AND ")}
            ORDER BY sequence ${request.order === "oldest" ? "ASC" : "DESC"}
            LIMIT ?
        `, values)

        const more = rows.length > limit
        const selected = rows.slice(0, limit).map(operation)
        const ordered = request.order === "oldest" ? selected : selected.reverse()
        const edge = request.order === "oldest" ? ordered.at(-1) : ordered[0]

        return Object.freeze({
            operations: Object.freeze(ordered),
            next: more && edge ? edge.sequence : null
        })
    }

    /** Returns the earliest operation of one kind for a Task. */
    public async firstOperation(task: string, kind: string): Promise<Operation | null> {

        return this.oneOperation(task, kind, "ASC")
    }

    /** Returns the latest operation of one kind for a Task. */
    public async latestOperation(task: string, kind: string): Promise<Operation | null> {

        return this.oneOperation(task, kind, "DESC")
    }

    /** Returns a bounded recent window of context-bearing operations. */
    public recentContextOperations(limit: number, excludeTask?: string): Promise<readonly Operation[]> {

        return this.contextOperations([], limit, excludeTask)
    }

    /** Searches the complete log but returns only a bounded candidate window. */
    public searchContextOperations(terms: readonly string[], limit: number, excludeTask?: string) {

        return this.contextOperations(terms, limit, excludeTask)
    }

    /** Reconstructs a bounded Model transcript without raw streaming events. */
    public async transcriptOperations(task: string, limit: number): Promise<readonly Operation[]> {

        const bounded = contextLimit(limit)
        const rows = await this.query<OperationRow>(`
            SELECT sequence, id, task_id, parent_id, kind, payload, created_at
            FROM operations
            WHERE task_id = ?
              AND kind IN ('model.message', 'tool.result')
            ORDER BY sequence DESC
            LIMIT ?
        `, [task, bounded])

        return Object.freeze(rows.map(operation).reverse())
    }

    /** Loads the input and latest lifecycle operation for a bounded set of Tasks. */
    public async taskContextOperations(tasks: readonly string[]): Promise<readonly Operation[]> {

        if (!tasks.length) return Object.freeze([])
        if (tasks.length > maximumTaskContextBatch) throw new Error("A Task context batch is too large")

        const placeholders = tasks.map(() => "?").join(", ")
        const rows = await this.query<OperationRow>(`
            SELECT sequence, id, task_id, parent_id, kind, payload, created_at
            FROM operations
            WHERE task_id IN (${placeholders})
              AND (
                kind = 'task.input'
                OR sequence = (
                    SELECT state.sequence
                    FROM operations AS state
                    WHERE state.task_id = operations.task_id
                      AND state.kind IN (${lifecycleKinds.map(kind => `'${kind}'`).join(", ")})
                    ORDER BY state.sequence DESC
                    LIMIT 1
                )
              )
            ORDER BY sequence
            LIMIT ?
        `, [...tasks, tasks.length * 2])

        return Object.freeze(rows.map(operation))
    }

    public async appendToTask(task: string, kind: string, payload: unknown): Promise<Operation> {

        const id = crypto.randomUUID()

        const createdAt = Date.now()

        const rows = await this.query<{ sequence: number; parent_id: string | null }>(`
            INSERT INTO operations (id, task_id, parent_id, kind, payload, created_at)
            SELECT ?, ?, id, ?, ?, ?
            FROM operations
            WHERE task_id = ?
            ORDER BY sequence DESC
            LIMIT 1
            RETURNING sequence, parent_id
        `, [id, task, kind, json(payload), createdAt, task])

        const recorded = rows[0]

        if (!recorded || typeof recorded.sequence !== "number") {

            throw new Error(`Lemo cannot append to unknown Task "${task}"`)
        }

        const operation = Object.freeze({
            sequence: recorded.sequence,
            id,
            task,
            parent: recorded.parent_id,
            kind,
            payload,
            createdAt
        })

        this.publish(operation)

        return operation
    }

    public async append(input: OperationInput): Promise<Operation> {

        const id = crypto.randomUUID()

        const createdAt = Date.now()

        const rows = await this.query<{ sequence: number }>(`
            INSERT INTO operations (id, task_id, parent_id, kind, payload, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            RETURNING sequence
        `, [
            id,
            input.task,
            input.parent,
            input.kind,
            json(input.payload),
            createdAt
        ])

        const sequence = rows[0]?.sequence

        if (typeof sequence !== "number") throw new Error("Lemo failed to record an operation")

        const operation = Object.freeze({
            sequence,
            id,
            task: input.task,
            parent: input.parent,
            kind: input.kind,
            payload: input.payload,
            createdAt
        })

        this.publish(operation)

        return operation
    }

    private async execute(statement: string): Promise<void> {

        if (programDatabase(this.source)) {

            await this.source.query(statement)

            return
        }

        this.source.exec(statement)
    }

    private async run(statement: string, values: readonly SQLInputValue[]): Promise<void> {

        if (programDatabase(this.source)) {

            await this.source.query(statement, [...values])

            return
        }

        this.source.prepare(statement).run(...values)
    }

    private async query<Row>(statement: string, values: readonly SQLInputValue[]): Promise<Row[]> {

        if (programDatabase(this.source)) return this.source.query<Row>(statement, [...values])

        return this.source.prepare(statement).all(...values) as Row[]
    }

    private async oneOperation(task: string, kind: string, order: "ASC" | "DESC") {

        const rows = await this.query<OperationRow>(`
            SELECT sequence, id, task_id, parent_id, kind, payload, created_at
            FROM operations
            WHERE task_id = ? AND kind = ?
            ORDER BY sequence ${order}
            LIMIT 1
        `, [task, kind])

        return rows[0] ? operation(rows[0]) : null
    }

    private async contextOperations(terms: readonly string[], limit: number, excludeTask?: string) {

        const bounded = contextLimit(limit)
        const selectedTerms = [...new Set(terms.map(term => term.trim().toLocaleLowerCase()).filter(Boolean))]
            .slice(0, maximumSearchTerms)
        const conditions = [`kind IN (${contextKinds.map(kind => `'${kind}'`).join(", ")})`]
        const values: SQLInputValue[] = []

        if (excludeTask) {

            conditions.push("task_id <> ?")
            values.push(excludeTask)
        }

        if (selectedTerms.length) {

            conditions.push(`(${selectedTerms.map(() => "LOWER(payload) LIKE ? ESCAPE '\\'").join(" OR ")})`)
            values.push(...selectedTerms.map(term => `%${like(term)}%`))
        }

        values.push(bounded)

        const rows = await this.query<OperationRow>(`
            SELECT sequence, id, task_id, parent_id, kind, ${contextPayload} AS payload, created_at
            FROM operations
            WHERE ${conditions.join(" AND ")}
            ORDER BY sequence DESC
            LIMIT ?
        `, values)

        return Object.freeze(rows.map(operation).reverse())
    }

    private publish(operation: Operation) {

        for (const subscriber of this.operationSubscribers) {

            try {
                subscriber(operation)
            } catch {
                this.operationSubscribers.delete(subscriber)
            }
        }

        if (!operation.task) return

        const subscribers = this.subscribers.get(operation.task)

        if (!subscribers) return

        for (const subscriber of subscribers) {

            try {
                subscriber(operation)
            } catch {

                subscribers.delete(subscriber)
            }
        }

        if (!subscribers.size) this.subscribers.delete(operation.task)
    }
}

export type LemoDatabaseSource = ProgramSql | DatabaseSync

export type TaskStatus = "running" | "paused" | "cancelled" | "completed" | "failed"

export type TaskSummary = Readonly<{
    id: string
    status: TaskStatus
    input: string
    source: "user" | "task"
    sourceTask: string | null
    sourceCall: string | null
    createdAt: number
    updatedAt: number
}>

export type TaskCursor = Readonly<{
    id: string
    createdAt: number
}>

export type TaskListRequest = Readonly<{
    limit: number
    cursor?: TaskCursor | null
    search?: string
    statuses?: readonly TaskStatus[]
    sourceTask?: string
    createdAfter?: number
    createdBefore?: number
    order?: "newest" | "oldest"
}>

export type TaskPage = Readonly<{
    tasks: readonly TaskSummary[]
    next: TaskCursor | null
}>

export type TaskMessageInput = Readonly<{
    sourceTask: string
    sourceCall: string
    targetTask: string
    content: string
}>

export type TaskMessage = Readonly<{
    sequence: number
    id: string
    sourceTask: string
    sourceCall: string
    targetTask: string
    content: string
    createdAt: number
    deliveredAt: number | null
}>

export type OperationPageRequest = Readonly<{
    limit: number
    before?: number
    after?: number
    order?: "newest" | "oldest"
}>

export type OperationPage = Readonly<{
    operations: readonly Operation[]
    next: number | null
}>

function statements(value: string) {

    return value
        .split("-- statement")
        .map(statement => statement.trim())
        .filter(Boolean)
}

function programDatabase(value: LemoDatabaseSource): value is ProgramSql {

    return "query" in value
}

function json(value: unknown) {

    const serialized = JSON.stringify(value)

    if (serialized === undefined) throw new Error("A Lemo operation payload must be JSON-compatible")

    return serialized
}

function taskLimit(value: number) {

    if (!Number.isInteger(value) || value < 1 || value > maximumTaskPage) {

        throw new Error(`A Task page limit must be between 1 and ${maximumTaskPage}`)
    }

    return value
}

function operationLimit(value: number) {

    if (!Number.isInteger(value) || value < 1 || value > maximumOperationPage) {

        throw new Error(`An operation page limit must be between 1 and ${maximumOperationPage}`)
    }

    return value
}

function contextLimit(value: number) {

    if (!Number.isInteger(value) || value < 1 || value > maximumContextOperations) {

        throw new Error(`A context operation limit must be between 1 and ${maximumContextOperations}`)
    }

    return value
}

function taskSummary(row: TaskSummaryRow): TaskSummary {

    return Object.freeze({
        id: row.id,
        status: taskState(row.status),
        input: row.input,
        source: row.source === "task" ? "task" : "user",
        sourceTask: row.source_task,
        sourceCall: row.source_call,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    })
}

function taskState(value: string): TaskStatus {

    if (
        value !== "running"
        && value !== "paused"
        && value !== "cancelled"
        && value !== "completed"
        && value !== "failed"
    ) throw new Error(`Lemo stored an invalid Task status "${value}"`)

    return value
}

function taskMessage(row: TaskMessageRow): TaskMessage {

    return Object.freeze({
        sequence: row.sequence,
        id: row.id,
        sourceTask: row.source_task_id,
        sourceCall: row.source_call,
        targetTask: row.target_task_id,
        content: row.content,
        createdAt: row.created_at,
        deliveredAt: row.delivered_at
    })
}

function like(value: string) {

    return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")
}

function operation(row: OperationRow): Operation {

    return Object.freeze({
        sequence: row.sequence,
        id: row.id,
        task: row.task_id,
        parent: row.parent_id,
        kind: row.kind,
        payload: JSON.parse(row.payload) as unknown,
        createdAt: row.created_at
    })
}

type OperationRow = Readonly<{
    sequence: number
    id: string
    task_id: string | null
    parent_id: string | null
    kind: string
    payload: string
    created_at: number
}>

type TaskSummaryRow = Readonly<{
    id: string
    status: string
    input: string
    source: string | null
    source_task: string | null
    source_call: string | null
    created_at: number
    updated_at: number
}>

type TaskMessageRow = Readonly<{
    sequence: number
    id: string
    source_task_id: string
    source_call: string
    target_task_id: string
    content: string
    created_at: number
    delivered_at: number | null
}>

export type OperationSubscriber = (operation: Operation) => void

export const maximumTaskPage = 100
export const maximumOperationPage = 256
export const maximumContextOperations = 2_048
export const maximumTaskContextBatch = 100
export const maximumContextMessages = 10

const maximumSearchTerms = 12

const lifecycleKinds = [
    "task.input",
    "task.run.started",
    "task.paused",
    "task.cancelled",
    "task.completed",
    "task.failed"
] as const

const contextKinds = [
    "task.input",
    "model.message",
    "model.event",
    "memory.recorded",
    "tool.result",
    "task.failed"
] as const

const taskStates = `
    WITH raw_task_states AS (
        SELECT
            tasks.id AS id,
            tasks.created_at AS created_at,
            COALESCE((
                SELECT operations.created_at
                FROM operations
                WHERE operations.task_id = tasks.id
                ORDER BY operations.sequence DESC
                LIMIT 1
            ), tasks.created_at) AS updated_at,
            COALESCE((
                SELECT operations.kind
                FROM operations
                WHERE operations.task_id = tasks.id
                  AND operations.kind IN (${lifecycleKinds.map(kind => `'${kind}'`).join(", ")})
                ORDER BY operations.sequence DESC
                LIMIT 1
            ), 'task.input') AS state_kind,
            COALESCE((
                SELECT json_extract(operations.payload, '$.input')
                FROM operations
                WHERE operations.task_id = tasks.id AND operations.kind = 'task.input'
                ORDER BY operations.sequence
                LIMIT 1
            ), '') AS input,
            (
                SELECT json_extract(operations.payload, '$.source.type')
                FROM operations
                WHERE operations.task_id = tasks.id AND operations.kind = 'task.input'
                ORDER BY operations.sequence
                LIMIT 1
            ) AS source,
            (
                SELECT json_extract(operations.payload, '$.source.task')
                FROM operations
                WHERE operations.task_id = tasks.id AND operations.kind = 'task.input'
                ORDER BY operations.sequence
                LIMIT 1
            ) AS source_task,
            (
                SELECT json_extract(operations.payload, '$.source.call')
                FROM operations
                WHERE operations.task_id = tasks.id AND operations.kind = 'task.input'
                ORDER BY operations.sequence
                LIMIT 1
            ) AS source_call
        FROM tasks
    ),
    task_states AS (
        SELECT
            id,
            CASE state_kind
                WHEN 'task.paused' THEN 'paused'
                WHEN 'task.cancelled' THEN 'cancelled'
                WHEN 'task.completed' THEN 'completed'
                WHEN 'task.failed' THEN 'failed'
                ELSE 'running'
            END AS status,
            input,
            source,
            source_task,
            source_call,
            created_at,
            updated_at
        FROM raw_task_states
    )
`

const contextPayload = `
    CASE
        WHEN kind = 'tool.result'
          AND json_extract(payload, '$.ok') = 1
          AND json_type(payload, '$.modelOutput') IS NOT NULL
        THEN json_object(
            'call', json_extract(payload, '$.call'),
            'name', json_extract(payload, '$.name'),
            'ok', json('true'),
            'modelOutput', json_extract(payload, '$.modelOutput')
        )
        ELSE payload
    END
`
