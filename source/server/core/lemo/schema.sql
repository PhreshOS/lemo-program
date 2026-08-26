CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL
) STRICT

-- statement

CREATE INDEX IF NOT EXISTS tasks_created ON tasks (created_at, id)

-- statement

CREATE TABLE IF NOT EXISTS messages (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    source_task_id TEXT NOT NULL REFERENCES tasks(id),
    source_call TEXT NOT NULL,
    target_task_id TEXT NOT NULL REFERENCES tasks(id),
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    delivered_at INTEGER
) STRICT

-- statement

CREATE INDEX IF NOT EXISTS messages_target
ON messages (target_task_id, sequence DESC)

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

-- statement

CREATE TABLE IF NOT EXISTS memory_retrievals (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    operation_id TEXT NOT NULL REFERENCES operations(id),
    requester_task_id TEXT REFERENCES tasks(id),
    requester_operation_id TEXT REFERENCES operations(id),
    requester_call TEXT,
    source TEXT NOT NULL,
    selection TEXT NOT NULL,
    score REAL NOT NULL,
    retrieved_at INTEGER NOT NULL
) STRICT

-- statement

CREATE INDEX IF NOT EXISTS memory_retrievals_operation
ON memory_retrievals (operation_id, retrieved_at DESC)

-- statement

CREATE INDEX IF NOT EXISTS memory_retrievals_requester
ON memory_retrievals (requester_task_id, sequence)

-- statement

CREATE TABLE IF NOT EXISTS memory_activations (
    operation_id TEXT PRIMARY KEY REFERENCES operations(id),
    strength REAL NOT NULL,
    retrieval_count INTEGER NOT NULL,
    last_retrieved_at INTEGER NOT NULL,
    strength_at INTEGER NOT NULL
) STRICT

-- statement

CREATE INDEX IF NOT EXISTS memory_activations_strength
ON memory_activations (strength DESC, last_retrieved_at DESC)
