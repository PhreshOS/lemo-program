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

OpenRouter owns its `{ apiKey }` configuration and uses the official
`@openrouter/sdk`. Its bounded live catalog contains only text-output Models
that support Tool calls and is retained for five minutes. Generations use
streaming Chat Completions, require routed endpoints to support every supplied
parameter, and reconstruct parallel Tool calls before yielding them to Lemo.

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

Provider configuration and activation are authoritative Server state. Their
mutation answers acknowledge only; after committing, Server Core publishes the
new Provider state outward through the shared `llm-provider.changed` event.
Every Manager and Agent representation retains that projection and refreshes
the external Model catalog when its revision changes. No View manually reloads
Provider state after issuing a command.

LLM Providers are self-registering on each MVC side. Server Core discovers the
`registration` exported by every `server/core/llm/providers/*/provider.ts`;
Client Core does the same for `client/core/llm/providers/*/provider.ts`; and
Client View discovers every `client/view/llm-providers/*.tsx` integration. The
Server View exposes the shared Provider state, configuration, activation, Model
discovery, and generation operations once. It has no Provider-specific
boundary implementation.

Consequently, adding a non-configurable LLM Provider requires five production
files: Server Provider and Model, Client Provider and Model, and its Client View
integration. A sixth Provider-owned `verify.ts` file is discovered by the shared
verification runner. No existing Application, View boundary, Task, registry,
test runner, or other Provider file is edited. A Provider with configuration
may add one owned schema file.

### Model metadata plan

LLM Models will retain the operational metadata that is common, or nearly
common, across Provider catalogs:

```ts
interface LLMModel {
    readonly id: string
    readonly name: string
    readonly provider: LLMProvider

    readonly limits: {
        context: number
        input?: number
        output?: number
    }

    readonly reasoning: {
        supported: boolean
        efforts?: readonly string[]
        defaultEffort?: string
        defaultEnabled?: boolean
        mandatory?: boolean
        supportsTokenBudget?: boolean
    }
}
```

OpenRouter and OpenCode can populate most of this metadata directly from their
catalogs. Ollama Cloud must inspect a selected Model through `/api/show` to
obtain its context window; properties that Ollama does not expose remain
absent rather than being guessed.

Every reconstructed Task context will identify both what its active LLM Model
supports and the reasoning configuration selected for that Task. The active
and initial `<llm_model>` entries will include the Provider identity, Model
identity, display name, context limit, optional input and output limits,
reasoning support, selected effort, and whether reasoning is mandatory.

Catalog metadata that does not help the Task operate—such as pricing,
architecture, parameter count, release date, and long descriptions—may remain
on the Provider-owned Model entity but will not be copied into every Cycle's
context. Model metadata remains Provider-owned and is normalized only where a
shared semantic contract is genuine.

## Lemo database

Server Core wakes the one enduring Lemo entity through:

```ts
const lemo = await Lemo.wakeUp(database, clientChannel)
```

Lemo accepts the PhreshOS Program database or a normal Node.js `DatabaseSync`
instance. Its schema retains Tasks, globally ordered raw operations, directed
Task messages, their original Task and parent relationships, and arbitrary
relationships between operations. Raw payloads remain JSON and no generated
context snapshot is stored. Retrievals are preserved separately as raw
observations containing their selected operation, requester, score, reason, and
timestamp. A replaceable activation projection keeps only the current
retrieval count, strength, and most recent retrieval time so ranking never has
to scan an indefinitely growing retrieval log.

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

Running Tasks communicate explicitly through the ordinary `tasks.send` Tool
operation. Every directed message durably retains its sending Task, Tool-call
identity, receiving Task, event, content, creation time, and first delivery time. The
message table is not capped: each Cycle reads only the receiving Task's 10
newest messages, in chronological order. A message first entering context is
identified as new; subsequent Cycles retain its original `deliveredAt` value
and identify it as previously delivered. A completed, failed, cancelled, or
paused Task cannot receive a message. `tasks.wait_message` waits for the next
message addressed to the invoking Task with one exact event.

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

A Cycle is an internal, disposable Model operation. It records its start and
reconstructs a token-bounded native transcript and a 50,000-token XML
Perceptual Field from the same raw database. Raw streamed `model.event` chunks
never consume transcript capacity. The Model receives one concise system
contract, then the Perceptual Field as contextual user data, followed by the
current Task's native user, assistant, and Tool messages. The current Task's
chronology therefore has one representation and one authority.

The field contains `environment`, current `task` identity, `continuity`,
`semantic_memory`, `rules`, and `inbox`. `continuity` is a single chronological,
source-labelled stream from nearby Tasks rather than a collection of synthetic
conversations. Provider configuration and credentials remain Provider-owned and
never enter Task context.

Each section has an estimated-token budget. Until Models expose their actual
tokenizers, Lemo uses a deterministic UTF-8 estimate of four bytes per token.
Oversized blocks are represented by bounded previews that retain their Task and
operation identities. `tasks.read` reconstructs omitted Task history as a
source-labelled event timeline; `tasks.read_block` reads a raw operation
completely in bounded token pages. No generated Perceptual Field is ever stored.
Every accepted text or tool-call event and the final assistant message are
persisted before the Cycle completes. Neither the constructed request nor its
snapshot is retained or reused by another Cycle.

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

Every Tool derives its Model-facing parameters from its sole Zod contract and
one Runtime-owned approval template. Lemo may add a flat `approval: true` to any
invocation, while a Tool may require approval from its own policy. Runtime
normalizes and validates the complete input once, publishes one bounded approval
interaction, and enters `execute` only after approval. Approval is invocation
state, never a second Tool call.

A Tool can identify its read-only operations as observations. Runtime compares
equivalent observations through durable input and output signatures. When the
observed state has not changed, the complete raw result is still preserved, but
the Model receives a concise `no-progress` result directing it to use existing
evidence, narrow the missing scope, change state, or report a blocker. This
prevents successful reads from becoming an invisible infinite loop without
misreporting the observation as a failure.

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
presentation unavailable to Server Runtime tools. The `files` tool owns a
separate UTF-8 filesystem layer: paths begin at the user's home directory,
directory reads are paginated, text reads are bounded, partial edits are
revision-aware, and recursive copies stream their contents. It does not expose
PhreshOS Storage or retain a working directory. The `shell` tool inspects the
host's available shells and runs independent non-interactive commands. Small
results are inline. Larger output is written in full into the raw Tool-result
operation; only its bounded Tool-owned preview enters immediate Model context,
and the complete result remains available through `tasks.read_block`. No
temporary output file is created.

Runtime discovers Tool modules from `runtime/tools/*/*.ts`, validates unique
names, and orders them through each Tool's optional `order`. Adding a Tool does
not require editing Runtime's catalog. A Tool marks itself `builtin` only when
its definition must be present in every Model cycle.

Memory is an internal mathematical view over the raw operation and retrieval
logs. It never copies operations into a second content store. Its stable
contract delegates retrieval, reinforcement, active-focus derivation, episode
expansion, token budgeting, XML formatting, and lazy Task/block projections to
one private Context component.
Cycle and the rest of the application therefore remain unchanged while that
frequently tested algorithm evolves.

Its governing principle is: store the complete raw truth, build a bounded and
structured awareness from it, and lazily retrieve anything omitted or
truncated. In this implementation, that bounded awareness is named the
Perceptual Field.

Recall uses a content-size budget rather than a Block-count radius. It favors
distinctive matches from the Task objective and latest durable working focus,
with temporal proximity added as a supporting signal. Related anchors are
expanded into local Task episodes. Every selected operation records its score
and retrieval time. Repeated retrieval increases a saturating activation value;
that value has a 30-day half-life while unused and becomes a factor in later
ranking. Each retrieval advances strength toward `1` rather than adding an
unbounded counter.

The Perceptual Field separates two retrieval directions. `semantic_memory`
selects candidates by semantic relevance and ranks them by semantic relevance
plus learned score and recency. `rules` selects candidates by learned score and
ranks them by learned score plus semantic relevance and recency. One operation
cannot occupy both sections in the same field. Repeatedly useful information can
therefore remain visible like a learned rule without contaminating semantic
selection. Provenance, strength, retrieval count, latest retrieval time, and
selection reason remain visible to the Model.

The Memory Tool defaults to 8,000 estimated tokens and accepts 256 through
16,000. Candidates that do not fit are skipped instead of blocking smaller
useful facts.

Task input, assistant content, explicit `memory.recorded` facts, failed Tool
results, Task failures, and successful Tool-owned context results are
candidates. Runtime always preserves the complete raw Tool output. A Tool can
add a distinct bounded `modelOutput` beside it; only that Tool-owned form is
eligible for later associative context. Omitting `modelOutput` deliberately
keeps a successful result out of automatic retrieval. The Memory Tool does so,
preventing recall output from recursively becoming more Memory.

Selected facts are anchors rather than isolated fragments. Memory
mathematically expands each anchor with its Task input, nearby facts across the
Task, and the correlated Tool request for a failed Tool result. Overlapping
operations are deduplicated. Consequently, many small facts may fit where only
a few large facts fit, while short dependent statements keep the surrounding
evidence needed to understand them.

Every Cycle loads bounded candidate windows from the global operation history
and independently rebuilds the Perceptual Field. The current Task contributes
identity, origin, execution state, and Model identity to the field while its
actual chronology remains in native messages. Nearby Tasks contribute objective
descriptors and one merged chronological timeline of meaningful assistant,
Tool, Memory, and failure events. A new Task with unclear direction therefore
inherits immediate continuity without losing the source of any action.

`inbox` contains only the 10 newest directed messages and identifies event,
source, creation time, delivery time, and whether this is their first
appearance. Every selected operation retains an ISO timestamp and its source.
Associative operations additionally state their selection reason, matching
terms, numerical association, and supporting anchor. XML keeps provenance and
lazy-retrieval hints explicit without converting retrieved context into another
system instruction.

Presence in the snapshot does not imply relevance, truth, or instruction.
Concurrent Tasks can therefore contribute committed experience to one shared
mind without mixing identities, confusing another Task's work with the current
Task's own actions, or allowing an incidental association to silently determine
behavior. The generated perceptual field remains disposable and is never
written back to Memory.

Every Tool receives a distinct Memory-writing capability through its execution
context. A Tool must deliberately record a durable domain fact; Runtime never
promotes raw tool output into such a fact. Each `memory.recorded` operation
preserves the supplied content, source, and recording method and is immediately
associated with its Task, tool name, and tool-call identity. Separately, each
Tool decides whether and how its successful result may enter reconstructed
Model context through `modelOutput`. Operational bookkeeping remains available
through the Tool's separate raw `record` capability.

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

Every state-changing Task request returns acknowledgment only. Task creation
uses a command identity recorded with `task.input`; the local `lemo.task()`
promise resolves when that correlated authoritative operation arrives.
Pause, continue, and cancel likewise change the local Task only through a
published operation, never through their mutation answer.

Server Core exposes one observation of every operation after it is committed
to Lemo's authoritative history. Server View publishes that observation
outward as `lemo.operation`; it does not create a private subscription for a
particular Client or Task. Any representation can therefore observe Task input,
Model output, Tool activity, interactions, and lifecycle changes in real time.

Client Core subscribes to the outward stream before requesting its bounded
database snapshot, then deduplicates any overlap, so fast Model output cannot
create a gap. Its projection contains every running or paused Task from newest
to oldest, followed by the 20 newest completed, failed, or cancelled Tasks in
the same order. Client
View renders a separator between those sections. Client-side `pause()`,
`continue()`, and `cancel()` operate through the local Task handle; View merely
renders their controls and state. Client-side operation history is only a
projection; Server SQLite remains authoritative.

An initial Task snapshot contains at most 256 recent raw operations plus its
input and an older-history cursor. Client Core can request older pages through
the Task entity and retains at most 2,048 operations at once, so a live Task
cannot create an unbounded Client collection or DOM. The raw Server history is
never truncated.

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

Manager startup configuration follows the same rule as Tasks and Providers:
the command acknowledges, Server Core publishes `manager.startup.changed`
outward, and every Manager updates its retained projection from that event.

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
