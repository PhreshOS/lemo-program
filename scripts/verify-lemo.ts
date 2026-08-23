import assert from "node:assert/strict"
import { DatabaseSync } from "node:sqlite"
import Lemo from "../source/server/core/lemo/lemo"

const database = new DatabaseSync(":memory:")

const lemo = await Lemo.wakeUp(database)

assert(lemo instanceof Lemo)

await Lemo.wakeUp(database)

const tables = database.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
`).all().map(row => row.name)

assert.deepEqual(tables, [
    "operation_relationships",
    "operations",
    "tasks"
])

const foreignKeys = database.prepare("PRAGMA foreign_keys").get()

assert.equal(foreignKeys?.foreign_keys, 1)

database.close()
