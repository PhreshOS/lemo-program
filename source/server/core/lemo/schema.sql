CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL
) STRICT

-- statement

CREATE INDEX IF NOT EXISTS tasks_created ON tasks (created_at, id)

-- statement

CREATE TABLE IF NOT EXISTS operations (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    task_id TEXT REFERENCES tasks(id),
    parent_id TEXT REFERENCES operations(id),
    kind TEXT NOT NULL,
    payload TEXT NOT NULL CHECK (json_valid(payload)),
    created_at INTEGER NOT NULL
) STRICT

-- statement

CREATE INDEX IF NOT EXISTS operations_task ON operations (task_id, sequence)

-- statement

CREATE INDEX IF NOT EXISTS operations_task_kind ON operations (task_id, kind, sequence)

-- statement

CREATE INDEX IF NOT EXISTS operations_parent ON operations (parent_id, sequence)

-- statement

CREATE TABLE IF NOT EXISTS operation_relationships (
    operation_id TEXT NOT NULL REFERENCES operations(id),
    related_operation_id TEXT NOT NULL REFERENCES operations(id),
    relationship TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (operation_id, related_operation_id, relationship)
) STRICT

-- statement

CREATE INDEX IF NOT EXISTS operation_relationships_related
ON operation_relationships (related_operation_id, relationship)
