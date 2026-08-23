import type { ProgramSql } from "@phreshos/core"
import type { DatabaseSync } from "node:sqlite"
import schema from "./schema.sql?raw"

/** Lemo's internal raw operation database. */
export default class LemoDatabase {

    private constructor(private readonly source: LemoDatabaseSource) {}

    public static async open(source: LemoDatabaseSource) {

        const database = new LemoDatabase(source)

        await database.execute("PRAGMA foreign_keys = ON")

        for (const statement of statements(schema)) await database.execute(statement)

        return database
    }

    private async execute(statement: string): Promise<void> {

        if (programDatabase(this.source)) {

            await this.source.query(statement)

            return
        }

        this.source.exec(statement)
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
