# Lemo

The public PhreshOS agent Program.

```bash
bun install
bun run dev
```

Lemo follows PhreshOS MVC, meaning Main, View, and Core:

```text
source/
├── client/
│   ├── main.tsx
│   ├── view/
│   │   ├── style.css
│   │   └── view.tsx
│   └── core/
│       └── application.ts
└── server/
    ├── main.ts
    ├── view/
    │   └── view.ts
    └── core/
        └── application.ts
```

Each Main starts its View, each View constructs its Core, and Core owns the
application.

## LLM contracts

Language-model capabilities are explicitly named `LLMProvider` and
`LLMModel`, leaving `Provider` and `Model` available to other capability
families.

An LLM Provider owns its Models. An LLM Model retains the bidirectional
relationship to its Provider and owns executable model behavior. Its generator
accepts one structured, ordered message request. Lemo receives an LLM Model for
an operation, never its Provider.

Server Core retains only initialized LLM Providers in `LLMProviders`.
There is no generic configuration shape.

Ollama Cloud owns its `{ apiKey }` configuration contract, Zod schema, raw HTTP
transport, model discovery, and LLM Model construction.
The TypeScript configuration contract is derived from that schema. Server Core
reads its raw value from `ollama-cloud:config` in the Program store and
constructs the Provider only when that key exists. No environment variable
configures an LLM Provider.

Every configured LLM Provider also retains an independent `active` property at
`<provider-identity>:active`. Inactive and unconfigured Providers are excluded
from Model loading. Loading all Models is one strict operation: if any active,
configured Provider fails, the complete operation fails without converting the
error into an empty Model list.

Client Core always retains an explicit Ollama Cloud configuration handle,
including while the authoritative Provider is unconfigured. It can inspect the
safe configured state, replace or remove configuration, discover Models, and
use each retained LLM Model directly. Client View renders Ollama Cloud through
its own integration; it never receives the stored API key.

## Lemo database

Server Core wakes the one enduring Lemo entity through:

```ts
const lemo = await Lemo.wakeUp(database)
```

Lemo accepts the PhreshOS Program database or a normal Node.js `DatabaseSync`
instance. Its schema retains Tasks, globally ordered raw operations, their
original Task and parent relationships, and arbitrary relationships between
operations. Raw payloads remain JSON without summaries, embeddings, retrieval
scores, decay values, or inferred semantic structure.

## Tasks

Each submitted input creates an independent Task and returns immediately after
the Task and its input have been recorded:

```ts
const task = await lemo.task({ input, model })
```

Tasks run concurrently and share Lemo's database. A Task is an entity rather
than a generator. `task.status()`, `task.operations()`, and `task.result()`
reconstruct durable state from the database. A fresh Lemo Process can recover a
Task through `lemo.findTask(taskId)` without an in-memory Task registry.

Input, raw Model events, reconstructed assistant messages, tool calls and
results, completion, and failure are recorded immediately as an unbroken parent
chain under the Task identity. A constructed Model request, including its
Memory snapshot, is disposable and is never retained. Its durable source facts
remain in the database, allowing every later Cycle to reconstruct it without
holding context in Process or Task memory.

## Cycles

A Cycle is an internal, disposable Model operation. It records its start, loads
the Task's ordered raw operations, reruns Memory retrieval from the original
Task input, and constructs a fresh request from those facts, the disposable
snapshot, and `system.md`. The current Task is excluded from its own automatic
snapshot. Every accepted text or tool-call event and the final assistant
message are persisted before the Cycle completes. Neither the constructed
request nor its snapshot is retained or reused by another Cycle.

Ollama Cloud maps this general message request directly to its streaming chat
API.

## Runtime

Lemo constructs and owns one internal Runtime. A Cycle that returns tool calls
asks Runtime to execute all independent calls concurrently. Runtime records
every result, and Task begins another Cycle that reconstructs its context from
the database. Task completes only when a Cycle requests no tools.

Before execution, Runtime applies the selected Tool's declared JSON Schema to
values returned by the Model. JSON-encoded objects, arrays, booleans, and
numbers are decoded only where the schema requires that type. The original
Model call remains raw and unchanged; a distinct `tool.input.normalized`
operation records any value actually normalized for execution. Unconstrained
payloads and declared strings are never guessed or rewritten.

Ordinary tools are not loaded into every Model request. Only the `tools`,
`docs`, and `memory` tools are initially visible. Tool discovery records which
tools were loaded, so every later Cycle reconstructs its available definitions
from the Task operation chain. `time` is the first ordinary, Zod-validated tool
and owns its implementation and documentation. The read-only `programs` tool
lists and inspects authoritative PhreshOS Programs and reads their declared
Endpoint Service documentation without copying temporary registry snapshots
into Memory. The `processes` tool reads and controls live Processes through the
actual Host and Program entities. Read operations remain ephemeral; successful
creation, named Process resolution, and exit are deliberately written through
the Tool's Memory context. The `endpoints` tool inspects and controls individual
Server and Client Endpoint lifecycles, can wait for Server readiness, and
records only successful start and stop operations. The `services` tool has no
listing API: it connects directly to coordinates learned from Program Endpoint
documentation, checks or awaits readiness, and passes Server Service questions
and answers through without interpreting or promoting them into Memory. The
`windows` tool reads and controls the authoritative Window belonging to a live
Client Endpoint while correctly leaving local Surface presentation unavailable
to Server Runtime tools.

Memory is an internal mathematical view over the existing raw operation log;
it does not copy history into a second memory table or alter the schema. Recall
uses a content-size budget rather than a Block-count radius. Half of the budget
preserves recent history, then the remaining half favors combined lexical and
temporal relevance. The default budget is 12,000 characters and explicit
Memory calls may request between 1,000 and 32,000. Task input, assistant
content, explicit `memory.recorded` facts, failed Tool results, and Task
failures are candidates. Successful Tool output and recall bookkeeping remain
excluded, preventing Memory from recursively recalling its own output.

Selected facts are anchors rather than isolated fragments. Memory
mathematically expands each anchor with its Task input, nearby facts across the
Task and global timeline, and the correlated Tool request for a failed Tool
result. Overlapping operations are deduplicated. Consequently, many small facts
may fit where only a few large facts fit, while short dependent statements keep
the surrounding evidence needed to understand them.

Every Cycle independently rebuilds its automatic cross-Task context. The
disposable context groups selected operations by their originating Task and
labels every operation with its global sequence, identity, parent, kind, time,
source, recording method, Tool, call, and selection role. This lets concurrent
Tasks contribute committed experience to one shared mind without merging their
durable Task identities or retaining a generated snapshot.

Every Tool receives a distinct Memory-writing capability through its execution
context. A Tool must deliberately record a fact; Runtime never promotes tool
output automatically. Each `memory.recorded` operation preserves the supplied
content, source, and recording method and is immediately associated with its
Task, tool name, and tool-call identity. Operational bookkeeping remains
available through the Tool's separate raw `record` capability.

## Client Tasks

Client Core exposes Lemo and its authoritative Tasks as local handles. Creating
a Task uses the selected local LLM Model handle, while Server Core resolves the
authoritative Model and starts execution. View never communicates with Server
or Runtime directly.

Each Client Task begins with a validated database snapshot and then applies
only newly persisted operations. The handoff subscribes before requesting the
snapshot and deduplicates any overlap, so fast Model output cannot create a
gap. Reloading View reconstructs completed Tasks from snapshots and reconnects
running Tasks. Client-side operation history is only a projection; Server
SQLite remains authoritative.
