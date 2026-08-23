import type { ProgramSql } from "@phreshos/core"
import type { DatabaseSync, SQLInputValue } from "node:sqlite"
import schema from "./schema.sql?raw"
import type Operation from "./operation"
import type { OperationInput } from "./operation"

/** Lemo's internal raw operation database. */
export default class LemoDatabase {

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

    public async hasTask(id: string) {

        const rows = await this.query<{ found: number }>(
            "SELECT 1 AS found FROM tasks WHERE id = ? LIMIT 1",
            [id]
        )

        return rows[0]?.found === 1
    }

    public async operations(task: string): Promise<readonly Operation[]> {

        const rows = await this.query<OperationRow>(`
            SELECT sequence, id, task_id, parent_id, kind, payload, created_at
            FROM operations
            WHERE task_id = ?
            ORDER BY sequence
        `, [task])

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

        return Object.freeze({
            sequence: recorded.sequence,
            id,
            task,
            parent: recorded.parent_id,
            kind,
            payload,
            createdAt
        })
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

        return Object.freeze({
            sequence,
            id,
            task: input.task,
            parent: input.parent,
            kind: input.kind,
            payload: input.payload,
            createdAt
        })
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
}

export type LemoDatabaseSource = ProgramSql | DatabaseSync

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
