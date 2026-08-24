# Lemo

The official PhreshOS agent Program.

```bash
bun install
bun run dev
```

Lemo follows PhreshOS MVC, meaning Main, View, and Core:

```text
source/
├── libs/
│   └── react-promise.ts
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

OpenCode Zen is initialized without configuration and exposes only anonymous,
zero-cost Models from OpenCode's public catalog. It discovers the catalog from
`https://models.opencode.ai/api.json`, ignores paid, deprecated, and unsupported
protocol entries, and sends generation requests to
`https://opencode.ai/zen/v1` with OpenCode's public credential. Catalog results
are retained for five minutes. The Provider owns both OpenAI-compatible Chat
Completions and OpenAI Responses protocol translation.

Ollama Cloud owns its `{ apiKey }` configuration contract, Zod schema, raw HTTP
transport, model discovery, and LLM Model construction.
The TypeScript configuration contract is derived from that schema. Server Core
reads its raw value from `ollama-cloud:config` in the Program store and
constructs the Provider only when that key exists. No environment variable
configures an LLM Provider.

Every LLM Provider also retains an independent `active` property at
`<provider-identity>:active`. Inactive and unconfigured Providers are excluded
from Model loading. Loading all Models is one strict operation: if any active,
configured Provider fails, the complete operation fails without converting the
error into an empty Model list.

Client Core always retains explicit OpenCode Zen and Ollama Cloud handles,
including while an authoritative configurable Provider is unconfigured. It can
inspect their safe state, control activation, manage Provider-owned
configuration where applicable, discover Models in one authoritative operation,
and use each retained LLM Model directly. Client View integrates each Provider
individually; it never receives the stored Ollama Cloud API key.

LLM Providers are self-registering on each MVC side. Server Core discovers the
`registration` exported by every `server/core/llm/providers/*/provider.ts`;
Client Core does the same for `client/core/llm/providers/*/provider.ts`; and
Client View discovers every `client/view/llm-providers/*.tsx` integration. The
Server View exposes the shared Provider state, configuration, activation, Model
discovery, and generation operations once. It has no Provider-specific events.

Consequently, adding a non-configurable LLM Provider requires five production
files: Server Provider and Model, Client Provider and Model, and its Client View
integration. A sixth Provider-owned `verify.ts` file is discovered by the shared
verification runner. No existing Application, View boundary, Task, registry,
test runner, or other Provider file is edited. A Provider with configuration
may add one owned schema file.

## Lemo database

Server Core wakes the one enduring Lemo entity through:

```ts
const lemo = await Lemo.wakeUp(database, clientChannel)
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
reconstruct durable state from the database. Each Task also exposes
`task.pause()`, `task.continue(model)`, and `task.cancel()`. Pausing is
reversible, cancellation is terminal, and continuation always starts a fresh
run reconstructed from durable history. A fresh Lemo Process can recover a Task
through `lemo.findTask(taskId)` without an in-memory Task registry.

Every run has a durable identity and a disposable `AbortSignal`. Stopping a run
interrupts Model streaming, Runtime Tools, and pending prompts. Calls left
unfinished by a pause receive an explicit interrupted Tool result so the next
Model cycle remains structurally complete. Results arriving from an obsolete
run cannot advance the Task.

Lemo does not expose a public destruction operation and does not depend on
shutdown cleanup. During every `Lemo.wakeUp()`, any Task still marked `running`
is durably changed to `paused` with reason `interrupted` before new work is
accepted. The same recovery rule therefore covers ordinary stops, crashes, and
forced termination.

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
lists and inspects authoritative PhreshOS Programs, projects whether each has
agent documentation, and reads that Program-owned knowledge only when
requested. It does not copy registry snapshots into Memory. The `processes`
tool reads and controls live Processes through the actual Host and Program
entities. Read operations remain ephemeral; successful creation, named Process
resolution, and exit are deliberately written through the Tool's Memory
context. The `endpoints` tool inspects and controls individual Server and Client
Endpoint lifecycles, waits for Server readiness, asks Server Endpoints, and
publishes to either Endpoint kind. It records only successful lifecycle changes
in Memory; direct communication remains in the Task operation history. The
`windows` tool reads and controls the authoritative Window
belonging to a live Client Endpoint while correctly leaving local Surface
presentation unavailable to Server Runtime tools.

Memory is an internal mathematical view over the existing raw operation log;
it does not copy history into a second memory table or alter the schema. Recall
uses a content-size budget rather than a Block-count radius. Half of the budget
preserves the latest statement and original input of recent Tasks, so one
cycle-heavy Task cannot displace several neighboring Tasks. The remaining half
favors combined lexical and temporal relevance. The default budget is 32,000
characters and explicit Memory calls may request between 1,000 and 32,000.
Candidates that do not fit are skipped instead of blocking smaller useful
facts. Task input, assistant
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

The Server View also composes its paired Client communication handle and passes
that general capability through Server Core into Lemo. Runtime never exposes
the raw handle to a Tool. For each call, it combines that handle with the
current Task identity, Tool-call identity, correlation, timeout, and the
client-facing prompt value to assemble a Task-bound `waitAnswer` capability in
the Tool context.

`prompt` is an ordinary discoverable Runtime Tool and is the first consumer of
`waitAnswer`. Runtime owns its bounded pending queue, first-terminal-event
settlement, authoritative result validation, and release. It supports a native
structured form and an interactive HTML document through one discriminated
contract. Both return either `{ type: "submitted", values }` or
`{ type: "cancelled" }`. Pausing or cancelling the Task releases its pending
prompt immediately. Invalid structured responses remain pending; document
runtime failures fail the Tool call.

## Client Tasks

Client Core exposes Lemo and its authoritative Tasks as local handles. Creating
a Task uses the selected local LLM Model handle, while Server Core resolves the
authoritative Model and starts execution. Client View composes communication
sources during initialization but does not coordinate operations.

Each Client Task begins with a validated database snapshot and then applies
only newly persisted operations. The handoff subscribes before requesting the
snapshot and deduplicates any overlap, so fast Model output cannot create a
gap. Reloading View reconstructs terminal Tasks from snapshots and reconnects
running or paused Tasks. Client-side `pause()`, `continue()`, and `cancel()`
operate through the local Task handle; View merely renders their controls and
state. Client-side operation history is only a projection; Server SQLite
remains authoritative.

Client Core also owns the minimal prompt contract it requires: receive a
renderable prompt associated with a Task, expose it as a local entity, and send
a correlated response. It knows nothing about Runtime, Tools, `waitAnswer`, the
pending queue, or transport mechanics. View renders each pending prompt only in
its associated Task and invokes the local prompt entity to submit, cancel, or
report a technical document failure. Native form controls are rendered directly
from the field contract. HTML is rendered in an opaque-origin iframe sandboxed
with only `allow-scripts allow-forms`; View inserts the complete frozen
`form.set(key, value)` and `form.submit()` bridge before document scripts and
accepts messages only from the correlated iframe. The Cancel control remains
outside that iframe. The prompt collection has a reversible mount lifecycle: it
subscribes before announcing readiness, so Runtime can resend every
still-pending prompt after a Client reload, including under React Strict Mode.

Task operation collections and pending-prompt collections expose stable local
snapshots that are replaced only when their authoritative projection changes.
Client View consumes those snapshots through `useSyncExternalStore`. Streaming
operations, Task status, prompt arrival, release, and response state therefore
invalidate exactly the rendered consumers that use them, including in a React
Compiler build; no unrelated render counter is used as a synchronization
signal.

## Async View state

Lemo Client View uses the shared, domain-neutral `usePromise` mechanism for
every finite asynchronous operation it represents. This remains View state;
Client and Server Core contracts and authoritative state do not change.

It covers:

- initial Task retrieval;
- LLM Provider state and LLM Model discovery;
- Provider configuration mutations;
- Task creation;
- Task pause, continue, and cancel controls.

Each dependency-driven read begins in `pending`, becomes `solve` with its real
value, or becomes `exception` with a visible failure and retry path. An empty
Task or Model collection is rendered only after a successful read returns an
empty collection. The View never initializes a resource to an artificial empty
value while its request is unresolved.

Manual operations use the manual executor and render its pending and exception
states. Pending state is scoped to the affected control. Task submission does
not globally disable the composer: newly submitted Tasks remain independent and
may begin while other Tasks run.

Task and prompt subscriptions remain effects with reversible cleanup because
they represent live lifecycles rather than finite Promise results. Their events
update the retained Client Core entities or the corresponding solved View
resource; they are not converted into one-shot requests.

The reusable hook is copied from the established System implementation into
`source/libs/react-promise.ts`; it remains local to Lemo and is not part of the
React SDK. Lemo uses the React SDK's `CurrentProvider` and `useProgram` instead
of maintaining a second application-name request and enables
`reactCompilerPreset`. The hook protects against stale
executions and updates after unmount while exposing explicit pending, solve,
and exception states. No caller may use a safe executor while leaving its
exception state unrendered. These mechanisms are applied throughout Lemo View
wherever they simplify the implementation without changing its semantics.
