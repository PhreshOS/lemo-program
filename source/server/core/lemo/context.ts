import type LemoDatabase from "./database"
import { maximumContextOperations, maximumTaskContextBatch } from "./database"
import type {
    MemoryActivation,
    MemoryRetrievalInput,
    TaskMessage
} from "./database"
import type Operation from "./operation"
import { taskStatus, type TaskStatus } from "./task"

export const defaultMemoryBudget = 32_000
export const minimumMemoryBudget = 1_000
export const maximumMemoryBudget = 32_000
const maximumAwarenessBudget = 8_000
const maximumAwarenessObjective = 400
const maximumAwarenessContent = 800
const maximumContinuityBudget = 8_000
const maximumContinuityTasks = 3
const maximumContinuityOperations = 6
const maximumContinuityContent = 1_200
const maximumReinforcedCandidates = 128
const maximumReinforcedBudget = 8_000
const reinforcedBudgetShare = 0.25
const reinforcedMemoryThreshold = 0.6
const episodeReinforcementShare = 0.25

export type MemoryRecallRequest = Readonly<{
    query: string
    budget?: number
    focus?: readonly MemoryFocus[]
}>

export type MemoryFocus = Readonly<{
    source: string
    content: string
    weight: number
}>

export type MemoryRecallOptions = Readonly<{
    excludeTask?: string
}>

export type MemoryRetrievalOrigin = Readonly<{
    task: string | null
    operation: string | null
    call: string | null
    source: "context" | "tool" | "memory"
}>

export type MemoryResult = Readonly<{
    sequence: number
    operation: string
    task: string
    parent: string | null
    kind: string
    content: string
    source: string
    method: string
    tool: string | null
    call: string | null
    selection: "recent" | "relevant" | "reinforced" | "context"
    reason: "semantic-association" | "explicit-recent" | "reinforced-memory" | "episode-context"
    score: number
    association: number | null
    reinforcement: number
    retrievalCount: number
    lastRetrievedAt: number | null
    matches: readonly string[]
    anchor: string | null
    createdAt: number
}>

/** Owns the disposable context-building algorithm over Lemo's raw operation history. */
export default class Context {

    public constructor(private readonly database: LemoDatabase) {}

    /** Rebuilds the complete disposable context snapshot for one Model cycle. */
    public async build(operations: readonly Operation[]): Promise<string> {

        const task = operations.find(operation => operation.task)?.task
        const now = Date.now()

        if (!task) throw new Error("A context requires a Task identity")

        const objective = taskInput(operations)
        const [history, messages] = await Promise.all([
            this.history(objective, operations),
            this.database.contextMessages(task)
        ])
        const states = taskStates(history)
        const self = states.get(task)

        if (!self) throw new Error("A context requires a durable Task")

        const focus = workingFocus(self.operations)
        const continuity = immediateContinuity(states, self)
        const awareness = activeAwareness(states, task)
        const continuitySize = continuity.reduce(
            (size, value) => size + continuityContextSize(value),
            0
        )
        const awarenessSize = awareness.tasks.reduce(
            (size, value) => size + awarenessContextSize(value),
            0
        )
        const budget = Math.max(
            minimumMemoryBudget,
            defaultMemoryBudget - continuitySize - awarenessSize
        )
        const continuityTasks = new Set(continuity.map(value => value.state.task))
        const others = history.filter(operation => (
            operation.task !== task && !continuityTasks.has(operation.task ?? "")
        ))
        const activations = await this.activations(others, now)
        const results = retrieve(
            others,
            { query: self.objective, focus, budget },
            false,
            activations
        )

        const recorded = await this.record(results, {
            task,
            operation: operations.findLast(operation => operation.kind === "cycle.started")?.id
                ?? operations.at(-1)?.id
                ?? null,
            call: null,
            source: "context"
        }, now)

        return contextSnapshot(self, messages, focus, continuity, awareness, recorded, states)
    }

    public async recall(
        request: MemoryRecallRequest,
        options: MemoryRecallOptions = {},
        origin: MemoryRetrievalOrigin = {
            task: null,
            operation: null,
            call: null,
            source: "memory"
        }
    ): Promise<readonly MemoryResult[]> {

        const now = Date.now()

        const operations = await this.history(
            request.query,
            [],
            options.excludeTask,
            request.focus ?? []
        )

        const results = retrieve(
            operations,
            request,
            true,
            await this.activations(operations, now)
        )

        return this.record(results, origin, now)
    }

    private async history(
        query: string,
        retained: readonly Operation[],
        excludeTask?: string,
        focus: readonly MemoryFocus[] = []
    ) {

        const terms = [...tokens([query, ...focus.map(value => value.content)].join(" "))]
            .filter(term => term.length > 1)
        const [recent, relevant, reinforced] = await Promise.all([
            this.database.recentContextOperations(maximumContextOperations, excludeTask),
            this.database.searchContextOperations(terms, maximumContextOperations, excludeTask),
            this.database.reinforcedContextOperations(maximumReinforcedCandidates, excludeTask)
        ])
        const selected = new Map<string, Operation>()

        for (const operation of [...reinforced, ...recent, ...relevant, ...retained]) {

            selected.set(operation.id, operation)
        }

        const tasks = [...new Set([...selected.values()].flatMap(operation => (
            operation.task ? [operation.task] : []
        )))]

        for (let index = 0; index < tasks.length; index += maximumTaskContextBatch) {

            const context = await this.database.taskContextOperations(
                tasks.slice(index, index + maximumTaskContextBatch)
            )

            for (const operation of context) selected.set(operation.id, operation)
        }

        return Object.freeze([...selected.values()]
            .filter(operation => operation.task !== excludeTask)
            .sort((left, right) => left.sequence - right.sequence))
    }

    private activations(operations: readonly Operation[], at: number) {

        return this.database.memoryActivations(
            [...new Set(operations.flatMap(operation => candidate(operation).map(value => value.operation.id)))],
            at
        )
    }

    private async record(
        results: readonly MemoryResult[],
        origin: MemoryRetrievalOrigin,
        retrievedAt: number
    ) {

        const values: MemoryRetrievalInput[] = results.map(result => ({
            operation: result.operation,
            requesterTask: origin.task,
            requesterOperation: origin.operation,
            requesterCall: origin.call,
            source: origin.source,
            selection: result.selection,
            score: result.score,
            retrievedAt
        }))

        await this.database.recordMemoryRetrievals(values)

        const activations = await this.database.memoryActivations(
            results.map(result => result.operation),
            retrievedAt
        )

        return Object.freeze(results.map(result => {

            const activation = activations.get(result.operation)

            return activation
                ? Object.freeze({
                    ...result,
                    reinforcement: rounded(activation.strength),
                    retrievalCount: activation.retrievalCount,
                    lastRetrievedAt: activation.lastRetrievedAt
                })
                : result
        }))
    }
}

/** Selects candidates without knowing how the resulting context is presented. */
function retrieve(
    operations: readonly Operation[],
    request: MemoryRecallRequest,
    preserveRecent: boolean,
    memory: ReadonlyMap<string, MemoryActivation>
): readonly MemoryResult[] {

    const query = request.query.trim()

    if (!query) throw new Error("Memory recall requires a query")

    const budget = request.budget ?? defaultMemoryBudget

    if (!Number.isInteger(budget) || budget < minimumMemoryBudget || budget > maximumMemoryBudget) {

        throw new Error(
            `Memory recall budget must be between ${minimumMemoryBudget} and ${maximumMemoryBudget} characters`
        )
    }

    const candidates = operations.flatMap(candidate)

    if (!candidates.length) return Object.freeze([])

    const index = contextIndex(operations, candidates)
    const focus = recallFocus(query, request.focus ?? [])
    const queryTokens = weightedTokens(focus)
    const frequencies = documentFrequencies(candidates)
    const selected = new Map<string, Selected>()
    const activations = new Map<string, Activation>()
    let size = 0

    const include = (
        value: Candidate,
        selection: MemoryResult["selection"],
        limit: number,
        anchor: string | null = null
    ) => {

        const existing = selected.get(value.operation.id)
        const candidateActivation = activations.get(value.operation.id)
        const perception = selectionPerception(
            selection,
            candidateActivation,
            anchor,
            anchor ? selected.get(anchor)?.score : undefined
        )

        if (existing) {

            if (existing.selection === "context" && selection !== "context") {

                selected.set(value.operation.id, { value, selection, ...perception })
            }

            return true
        }

        const addition = contextSize(value)

        if (size + addition > limit) return false

        selected.set(value.operation.id, { value, selection, ...perception })
        size += addition

        return true
    }

    const collect = (
        anchors: readonly Candidate[],
        selection: "recent" | "relevant" | "reinforced",
        target: number,
        contextFor: (anchor: Candidate, index: ContextIndex) => readonly Candidate[]
    ) => {

        for (const anchor of anchors) {

            if (size >= target) break
            if (!include(anchor, selection, target)) continue

            for (const context of contextFor(anchor, index)) {

                if (size >= target) break

                include(context, "context", target, anchor.operation.id)
            }
        }
    }

    const latest = candidates.at(-1)!.operation.sequence
    const scored = candidates
        .map(value => ({
            value,
            ...activation(
                value.content,
                focus,
                queryTokens,
                frequencies,
                candidates.length,
                latest - value.operation.sequence,
                memory.get(value.operation.id)
            )
        }))

    for (const value of scored) activations.set(value.value.operation.id, value)

    const activated = scored
        .filter(value => value.association > 0)
        .sort((left, right) => (
            right.score - left.score
            || right.value.operation.sequence - left.value.operation.sequence
        ))

    const relevant = activated.map(value => value.value)
    const reinforced = scored
        .filter(value => value.reinforcement >= reinforcedMemoryThreshold)
        .sort((left, right) => (
            right.reinforcement - left.reinforcement
            || right.score - left.score
            || right.value.operation.sequence - left.value.operation.sequence
        ))
        .map(value => value.value)

    if (preserveRecent) {

        collect(relevant, "relevant", Math.ceil(budget * 0.75), episodeContext)
        collect(recentAnchors(index), "recent", budget, recentContext)
        collect(relevant, "relevant", budget, episodeContext)
    } else {

        collect(
            reinforced,
            "reinforced",
            Math.min(maximumReinforcedBudget, Math.floor(budget * reinforcedBudgetShare)),
            episodeContext
        )
        collect(relevant, "relevant", budget, episodeContext)
    }

    return Object.freeze([...selected.values()]
        .sort((left, right) => left.value.operation.sequence - right.value.operation.sequence)
        .map(value => result(value.value, value.selection, value)))
}

function selectionPerception(
    selection: MemoryResult["selection"],
    activation: Activation | undefined,
    anchor: string | null,
    anchorScore?: number
): SelectionPerception {

    const reinforcement = rounded(activation?.reinforcement ?? 0)
    const retrievalCount = activation?.retrievalCount ?? 0
    const lastRetrievedAt = activation?.lastRetrievedAt ?? null

    if (selection === "relevant") {

        return Object.freeze({
            reason: "semantic-association" as const,
            score: rounded(activation?.score ?? 0),
            association: activation ? rounded(activation.association) : null,
            reinforcement,
            retrievalCount,
            lastRetrievedAt,
            matches: Object.freeze(activation?.matches ?? []),
            anchor: null
        })
    }

    if (selection === "reinforced") {

        return Object.freeze({
            reason: "reinforced-memory" as const,
            score: rounded(Math.max(activation?.score ?? 0, activation?.reinforcement ?? 0)),
            association: activation ? rounded(activation.association) : null,
            reinforcement,
            retrievalCount,
            lastRetrievedAt,
            matches: Object.freeze(activation?.matches ?? []),
            anchor: null
        })
    }

    if (selection === "recent") {

        return Object.freeze({
            reason: "explicit-recent" as const,
            score: rounded(activation?.score ?? 0),
            association: null,
            reinforcement,
            retrievalCount,
            lastRetrievedAt,
            matches: Object.freeze([]),
            anchor: null
        })
    }

    return Object.freeze({
        reason: "episode-context" as const,
        score: rounded((anchorScore ?? activation?.score ?? 0) * episodeReinforcementShare),
        association: null,
        reinforcement,
        retrievalCount,
        lastRetrievedAt,
        matches: Object.freeze([]),
        anchor
    })
}

function taskInput(operations: readonly Operation[]) {

    const operation = operations.find(candidate => candidate.kind === "task.input")
    const payload = record(operation?.payload)

    if (typeof payload?.input !== "string" || !payload.input.trim()) {

        throw new Error("A Task has no valid input operation")
    }

    return payload.input
}

/** Reconstructs the Task's own durable identity without persisting a derived snapshot. */
function taskIdentity(operations: readonly Operation[]) {

    const input = operations.find(operation => operation.kind === "task.input")
    const inputPayload = record(input?.payload)
    const source = record(inputPayload?.source)
    const initialModel = modelIdentity(inputPayload?.model)
    const run = operations.findLast(operation => operation.kind === "task.run.started")
    const runPayload = record(run?.payload)
    const cycle = operations.findLast(operation => operation.kind === "cycle.started")
    const cyclePayload = record(cycle?.payload)
    const activeModel = modelIdentity(cyclePayload?.model)
        ?? modelIdentity(runPayload?.model)
        ?? initialModel
    const sourceTask = typeof source?.task === "string" ? source.task : null
    const sourceCall = typeof source?.call === "string" ? source.call : null
    const origin: TaskOrigin = source?.type === "task" && sourceTask && sourceCall
        ? Object.freeze({ type: "task", task: sourceTask, call: sourceCall })
        : Object.freeze({ type: "user", task: null, call: null })
    const reason = runPayload?.reason === "created" || runPayload?.reason === "continued"
        ? runPayload.reason
        : null

    return Object.freeze({
        origin,
        initialModel,
        activeModel,
        execution: Object.freeze({
            run: typeof runPayload?.run === "string" ? runPayload.run : null,
            reason,
            startedAt: run?.createdAt ?? null,
            cycle: cycle?.id ?? null,
            cycleStartedAt: cycle?.createdAt ?? null
        }) satisfies TaskExecution
    })
}

function modelIdentity(value: unknown): ModelIdentity | null {

    const model = record(value)

    return typeof model?.provider === "string" && typeof model.id === "string"
        ? Object.freeze({ provider: model.provider, id: model.id })
        : null
}

function taskStates(operations: readonly Operation[]) {

    const grouped = new Map<string, Operation[]>()

    for (const operation of operations) {

        if (!operation.task) continue

        const values = grouped.get(operation.task) ?? []

        values.push(operation)
        grouped.set(operation.task, values)
    }

    return new Map([...grouped].map(([task, values]) => {

        const candidates = values.flatMap(operation => {

            const call = toolCall(operation)

            return call ? [...candidate(operation), call] : candidate(operation)
        })

        const status = taskStatus(values)
        const createdAt = values[0]!.createdAt
        const updatedAt = values.at(-1)!.createdAt
        const identity = taskIdentity(values)

        return [task, Object.freeze({
            task,
            status,
            objective: taskInput(values),
            ...identity,
            createdAt,
            updatedAt,
            endedAt: terminalTaskStatuses.has(status) ? updatedAt : null,
            sequence: values[0]!.sequence,
            operations: Object.freeze(values),
            candidates: Object.freeze(candidates)
        }) satisfies TaskState]
    }))
}

/** Preserves causal continuity for short references such as "again" or "continue". */
function immediateContinuity(
    states: ReadonlyMap<string, TaskState>,
    self: TaskState
): readonly TaskContinuity[] {

    const preceding = [...states.values()]
        .filter(state => state.task !== self.task && state.sequence < self.sequence)
        .sort((left, right) => right.sequence - left.sequence)
    const available = preceding
        .map((state, index) => ({
            state,
            distance: index + 1,
            operations: Object.freeze(state.candidates
                .filter(value => value.method !== "task-input")
                .slice(-maximumContinuityOperations))
        }))
        .filter(value => value.state.status !== "running")
    const selected: TaskContinuity[] = []
    let size = 0

    for (const value of available) {

        if (selected.length >= maximumContinuityTasks) break

        const addition = continuityContextSize(value)

        if (size + addition > maximumContinuityBudget) continue

        selected.push(Object.freeze(value))
        size += addition
    }

    return Object.freeze(selected)
}

function continuityContextSize(value: TaskContinuity) {

    return Math.min(value.state.objective.length, maximumAwarenessObjective)
        + value.operations.reduce(
            (size, operation) => size + Math.min(operation.content.length, maximumContinuityContent) + 220,
            0
        )
        + 480
}

function activeAwareness(states: ReadonlyMap<string, TaskState>, self: string): Awareness {

    const available = [...states.values()]
        .filter(state => state.task !== self && state.status === "running")
        .map(state => Object.freeze({
            state,
            latest: state.candidates.findLast(value => value.method !== "task-input") ?? null,
            sequence: state.operations.at(-1)?.sequence ?? 0
        }))
        .sort((left, right) => right.sequence - left.sequence)
    const selected: TaskAwareness[] = []
    let size = 0

    for (const value of available) {

        const addition = awarenessContextSize(value)

        if (size + addition > maximumAwarenessBudget) continue

        selected.push(value)
        size += addition
    }

    return Object.freeze({
        tasks: Object.freeze(selected),
        omitted: available.length - selected.length
    })
}

function awarenessContextSize(value: TaskAwareness) {

    return Math.min(value.state.objective.length, maximumAwarenessObjective)
        + Math.min(value.latest?.content.length ?? 0, maximumAwarenessContent)
        + 320
}

/** Derives the active subject from the latest durable state of this Task. */
function workingFocus(operations: readonly Operation[]): readonly WorkingSignal[] {

    const focus: WorkingSignal[] = []

    for (let index = operations.length - 1; index >= 0 && focus.length < 6; index--) {

        const operation = operations[index]
        const payload = record(operation.payload)

        if (operation.kind === "tool.result") {

            const name = typeof payload?.name === "string" ? payload.name : "unknown"
            const output = payload?.ok === true
                ? "modelOutput" in (payload ?? {}) ? payload?.modelOutput : { ok: true }
                : { ok: false, error: payload?.error }

            addFocus(
                focus,
                operation,
                `tool:${name}`,
                "tool-result",
                `Tool ${name} returned ${json(output)}`,
                2.4,
                name,
                text(payload?.call) || null
            )

            continue
        }

        if (operation.kind === "model.message") {

            const content = typeof payload?.content === "string" ? payload.content.trim() : ""
            const calls = Array.isArray(payload?.toolCalls) && payload.toolCalls.length
                ? `Tool requests: ${json(payload.toolCalls)}`
                : ""

            addFocus(
                focus,
                operation,
                "lemo",
                "model-message",
                [content, calls].filter(Boolean).join("\n"),
                1.6
            )

            continue
        }

        if (operation.kind === "memory.recorded") {

            const memory = record(payload?.record)

            addFocus(
                focus,
                operation,
                text(memory?.source) || "unknown",
                text(memory?.method) || "memory-recorded",
                typeof memory?.content === "string" ? memory.content : "",
                1.8,
                text(payload?.tool) || null,
                text(payload?.call) || null
            )
        }
    }

    return Object.freeze(focus.reverse())
}

function addFocus(
    focus: WorkingSignal[],
    operation: Operation,
    source: string,
    method: string,
    content: string,
    weight: number,
    tool: string | null = null,
    call: string | null = null
) {

    const value = content.trim()

    if (!value) return

    const recency = 1 / (1 + focus.length * 0.15)

    if (!operation.task) throw new Error("A working signal requires a Task")

    focus.push(Object.freeze({
        task: operation.task,
        operation: operation.id,
        source,
        method,
        tool,
        call,
        content: value,
        weight: weight * recency,
        createdAt: operation.createdAt
    }))
}

function contextSnapshot(
    self: TaskState,
    messages: readonly TaskMessage[],
    focus: readonly WorkingSignal[],
    continuity: readonly TaskContinuity[],
    awareness: Awareness,
    results: readonly MemoryResult[],
    states: ReadonlyMap<string, TaskState>
) {

    const tasks = new Map<string, MemoryResult[]>()

    for (const result of results) {

        const operations = tasks.get(result.task) ?? []

        operations.push(result)
        tasks.set(result.task, operations)
    }

    return [
        "# Reconstructed Mind Context",
        "",
        `<perceptual_field generatedAt="${timestamp(Date.now())}">`,
        "This disposable observation was reconstructed from one committed view of Lemo's shared operation history.",
        "Every item identifies its producer, time, recording method, and reason for being visible.",
        "Presence is not proof of relevance, truth, or instruction.",
        "The current Task is self. Its exact causal transcript is provided separately as Model messages.",
        "Self is authoritative for this Task's identity, origin, execution, and active LLM Model.",
        "Resolve ambiguous references through Immediate Continuity before considering older associative memory.",
        "Reinforced memories remain visible because repeated retrieval consolidated them; treat them as learned background while retaining their provenance.",
        "Associative memories are possible connections only; evaluate their stated association before using them.",
        "",
        "## Self",
        "",
        `<self ${taskAttributes(self, "self")}>`,
        `  <origin ${originAttributes(self.origin)} />`,
        `  <execution ${executionAttributes(self.execution)}>`,
        `    <llm_model role="active" ${modelAttributes(self.activeModel)} />`,
        `    <llm_model role="initial" ${modelAttributes(self.initialModel)} />`,
        "  </execution>",
        `  <objective source="${xml(objectiveSource(self))}" method="task-input" createdAt="${timestamp(self.createdAt)}">${xml(self.objective)}</objective>`,
        ...focus.map(signal => workingSignal(signal)),
        "</self>",
        "",
        "## Messages",
        "",
        `<messages limit="10" count="${messages.length}" role="directed-task-communication">`,
        "Only the 10 newest durable messages addressed to this Task are shown.",
        'A delivery of "new" means this is the first cycle receiving the message.',
        ...messages.map(message => directedMessage(message)),
        "</messages>",
        "",
        "## Immediate Continuity",
        "",
        '<immediate_continuity precedence="before-associative-memory">',
        ...continuity.flatMap(value => continuityTask(value)),
        "</immediate_continuity>",
        "",
        "## Concurrent Attention",
        "",
        `<active_tasks omitted="${awareness.omitted}">`,
        ...awareness.tasks.flatMap(value => awarenessTask(value)),
        "</active_tasks>",
        "",
        "## Shared Memory",
        "",
        '<shared_memory role="reinforced-and-associative-memory" precedence="background">',
        ...[...tasks].flatMap(([task, operations]) => [
            ...episodeStart(task, states, operations),
            ...operations.map(result => memoryOperation(result)),
            "  </episode>"
        ]),
        "</shared_memory>",
        "</perceptual_field>"
    ].join("\n")
}

function directedMessage(message: TaskMessage) {

    const attributes = [
        ["sequence", String(message.sequence)],
        ["id", message.id],
        ["sourceTask", message.sourceTask],
        ["sourceCall", message.sourceCall],
        ["createdAt", timestamp(message.createdAt)],
        ["deliveredAt", message.deliveredAt === null ? "" : timestamp(message.deliveredAt)],
        ["delivery", message.deliveredAt === null ? "new" : "previously-delivered"]
    ].map(([name, value]) => `${name}="${xml(value)}"`).join(" ")

    return `  <message ${attributes}>${xml(message.content)}</message>`
}

function workingSignal(signal: WorkingSignal) {

    const attributes = [
        ["task", signal.task],
        ["operation", signal.operation],
        ["source", signal.source],
        ["method", signal.method],
        ["tool", signal.tool ?? ""],
        ["call", signal.call ?? ""],
        ["createdAt", timestamp(signal.createdAt)],
        ["reason", "current-task-focus"],
        ["weight", String(signal.weight)]
    ].map(([name, value]) => `${name}="${xml(value)}"`).join(" ")

    return `  <signal ${attributes}>${xml(signal.content)}</signal>`
}

function continuityTask(value: TaskContinuity) {

    const relation = value.distance === 1 ? "immediately-before" : "recent-predecessor"

    return [
        `  <task ${taskAttributes(value.state, relation)} distance="${value.distance}" reason="temporal-continuity">`,
        `    <objective source="${xml(objectiveSource(value.state))}" method="task-input" createdAt="${timestamp(value.state.createdAt)}">${xml(shorten(value.state.objective, maximumAwarenessObjective))}</objective>`,
        ...value.operations.map(operation => candidateOperation(
            operation,
            "    ",
            "temporal-continuity",
            maximumContinuityContent
        )),
        "  </task>"
    ]
}

function episodeStart(
    task: string,
    states: ReadonlyMap<string, TaskState>,
    operations: readonly MemoryResult[]
) {

    const state = states.get(task)
    const reason = operations.some(operation => operation.reason === "reinforced-memory")
        ? "reinforced-memory"
        : "possible-semantic-association"

    if (!state) throw new Error(`Context selected unknown Task "${task}"`)

    return [
        `  <episode ${taskAttributes(state, "associative")} reason="${reason}">`,
        `    <objective source="${xml(objectiveSource(state))}" method="task-input" createdAt="${timestamp(state.createdAt)}">${xml(shorten(state.objective, maximumAwarenessObjective))}</objective>`
    ]
}

function awarenessTask(value: TaskAwareness) {

    const latest = value.latest

    return [
        `  <task ${taskAttributes(value.state, "concurrent")} reason="currently-running">`,
        `    <objective source="${xml(objectiveSource(value.state))}" method="task-input" createdAt="${timestamp(value.state.createdAt)}">${xml(shorten(value.state.objective, maximumAwarenessObjective))}</objective>`,
        latest
            ? candidateOperation(latest, "    ", "concurrent-attention", maximumAwarenessContent)
            : "    <operation />",
        "  </task>"
    ]
}

function memoryOperation(result: MemoryResult, indentation = "    ", maximum?: number) {

    const attributes = [
        ["sequence", String(result.sequence)],
        ["id", result.operation],
        ["parent", result.parent ?? ""],
        ["kind", result.kind],
        ["createdAt", timestamp(result.createdAt)],
        ["source", result.source],
        ["method", result.method],
        ["tool", result.tool ?? ""],
        ["call", result.call ?? ""],
        ["selection", result.selection],
        ["reason", result.reason],
        ["score", String(result.score)],
        ["association", result.association === null ? "" : String(result.association)],
        ["reinforcement", String(result.reinforcement)],
        ["retrievalCount", String(result.retrievalCount)],
        ["lastRetrievedAt", result.lastRetrievedAt === null ? "" : timestamp(result.lastRetrievedAt)],
        ["matches", result.matches.join(",")],
        ["anchor", result.anchor ?? ""]
    ].map(([name, value]) => `${name}="${xml(value)}"`).join(" ")

    const content = maximum === undefined ? result.content : shorten(result.content, maximum)

    return `${indentation}<operation ${attributes}>${xml(content)}</operation>`
}

function candidateOperation(
    value: Candidate,
    indentation: string,
    reason: "temporal-continuity" | "concurrent-attention",
    maximum: number
) {

    const operation = value.operation
    const attributes = [
        ["sequence", String(operation.sequence)],
        ["id", operation.id],
        ["parent", operation.parent ?? ""],
        ["kind", operation.kind],
        ["createdAt", timestamp(operation.createdAt)],
        ["source", value.source],
        ["method", value.method],
        ["tool", value.tool ?? ""],
        ["call", value.call ?? ""],
        ["reason", reason]
    ].map(([name, content]) => `${name}="${xml(content)}"`).join(" ")

    return `${indentation}<operation ${attributes}>${xml(shorten(value.content, maximum))}</operation>`
}

function taskAttributes(state: TaskState, relation: string) {

    return [
        ["task", state.task],
        ["perspective", relation === "self" ? "self" : "other"],
        ["relation", relation],
        ["status", state.status],
        ["startedAt", timestamp(state.createdAt)],
        ["updatedAt", timestamp(state.updatedAt)],
        ["endedAt", state.endedAt === null ? "" : timestamp(state.endedAt)]
    ].map(([name, value]) => `${name}="${xml(value)}"`).join(" ")
}

function originAttributes(origin: TaskOrigin) {

    return [
        ["type", origin.type],
        ["task", origin.task ?? ""],
        ["call", origin.call ?? ""]
    ].map(([name, value]) => `${name}="${xml(value)}"`).join(" ")
}

function executionAttributes(execution: TaskExecution) {

    return [
        ["run", execution.run ?? ""],
        ["reason", execution.reason ?? ""],
        ["startedAt", execution.startedAt === null ? "" : timestamp(execution.startedAt)],
        ["cycle", execution.cycle ?? ""],
        ["cycleStartedAt", execution.cycleStartedAt === null
            ? ""
            : timestamp(execution.cycleStartedAt)]
    ].map(([name, value]) => `${name}="${xml(value)}"`).join(" ")
}

function modelAttributes(model: ModelIdentity | null) {

    return [
        ["provider", model?.provider ?? ""],
        ["id", model?.id ?? ""]
    ].map(([name, value]) => `${name}="${xml(value)}"`).join(" ")
}

function objectiveSource(state: TaskState) {

    return state.origin.type === "task" ? `task:${state.origin.task}` : "user"
}

function timestamp(value: number) {

    return new Date(value).toISOString()
}

function xml(value: string) {

    return value
        .replaceAll("&", "&amp;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&apos;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
}

/** Preserves the latest durable statement from each Task before adding depth. */
function recentAnchors(index: ContextIndex) {

    return [...index.tasks.values()]
        .map(task => task.at(-1))
        .filter((value): value is Candidate => value !== undefined)
        .sort((left, right) => right.operation.sequence - left.operation.sequence)
}

/** A recent Task needs its question, not every intermediate Model cycle. */
function recentContext(anchor: Candidate, index: ContextIndex) {

    const task = anchor.operation.task ? index.tasks.get(anchor.operation.task) ?? [] : []
    const input = task.find(value => value.method === "task-input")

    return input && input.operation.id !== anchor.operation.id ? [input] : []
}

function candidate(operation: Operation): readonly Candidate[] {

    const payload = record(operation.payload)
    const memory = record(payload?.record)

    if (operation.kind === "task.input") {

        return createCandidate(operation, payload?.input, "user", "task-input")
    }

    if (operation.kind === "model.message") {

        return createCandidate(operation, payload?.content, "lemo", "model-message")
    }

    if (operation.kind === "memory.recorded") {

        return createCandidate(
            operation,
            memory?.content,
            text(memory?.source) || "unknown",
            text(memory?.method) || "memory-recorded",
            text(payload?.tool) || null,
            text(payload?.call) || null
        )
    }

    if (operation.kind === "tool.result" && payload?.ok === true && "modelOutput" in (payload ?? {})) {

        const tool = text(payload?.name) || "unknown"

        return createCandidate(
            operation,
            payload?.modelOutput,
            `tool:${tool}`,
            "tool-result",
            tool,
            text(payload?.call) || null
        )
    }

    if (operation.kind === "tool.result" && payload?.ok === false) {

        const tool = text(payload.name) || "unknown"
        const error = text(payload.error)

        return createCandidate(
            operation,
            error ? `Tool ${tool} failed: ${error}` : `Tool ${tool} failed`,
            "runtime",
            "tool-result",
            tool,
            text(payload.call) || null
        )
    }

    if (operation.kind === "task.failed") {

        const error = text(payload?.message)

        return createCandidate(
            operation,
            error ? `Task failed: ${error}` : "Task failed",
            "lemo",
            "task-failure"
        )
    }

    return []
}

function createCandidate(
    operation: Operation,
    value: unknown,
    source: string,
    method: string,
    tool: string | null = null,
    call: string | null = null
): readonly Candidate[] {

    const content = contextualText(value)

    return content.trim() ? [{ operation, content, source, method, tool, call }] : []
}

function contextIndex(operations: readonly Operation[], candidates: readonly Candidate[]): ContextIndex {

    const tasks = new Map<string, Candidate[]>()

    for (const value of candidates) {

        if (!value.operation.task) continue

        const task = tasks.get(value.operation.task) ?? []

        task.push(value)
        tasks.set(value.operation.task, task)
    }

    const toolCalls = new Map<string, Candidate>()

    for (const operation of operations) {

        const value = toolCall(operation)

        if (value?.call) toolCalls.set(value.call, value)
    }

    return {
        tasks,
        toolCalls
    }
}

/** Expands one activated fact into a coherent local Task episode. */
function episodeContext(anchor: Candidate, index: ContextIndex) {

    const values: Candidate[] = []
    const task = anchor.operation.task ? index.tasks.get(anchor.operation.task) ?? [] : []
    const taskPosition = task.findIndex(value => value.operation.id === anchor.operation.id)

    add(values, task.find(value => value.method === "task-input"))
    add(values, task[taskPosition - 2])
    add(values, task[taskPosition - 1])
    add(values, task[taskPosition + 1])
    add(values, task[taskPosition + 2])

    if (anchor.call) add(values, index.toolCalls.get(anchor.call))

    return values.filter(value => value.operation.id !== anchor.operation.id)
}

function toolCall(operation: Operation): Candidate | null {

    if (operation.kind !== "model.event") return null

    const payload = record(operation.payload)

    if (payload?.type !== "tool-call") return null

    const call = record(payload.call)
    const id = text(call?.id)
    const tool = text(call?.name)

    if (!id || !tool) return null

    return {
        operation,
        content: `Tool ${tool} requested with input: ${json(call?.input)}`,
        source: "lemo",
        method: "tool-call",
        tool,
        call: id
    }
}

function add(values: Candidate[], value: Candidate | undefined) {

    if (value && !values.some(candidate => candidate.operation.id === value.operation.id)) values.push(value)
}

function contextSize(candidate: Candidate) {

    return candidate.content.length + 180
}

function recallFocus(query: string, values: readonly MemoryFocus[]) {

    const focus: MemoryFocus[] = [{ source: "task-objective", content: query, weight: 1 }]

    for (const value of values) {

        const content = value.content.trim()
        const source = value.source.trim()

        if (!content || !source || !Number.isFinite(value.weight) || value.weight <= 0) {

            throw new Error("Memory focus signals require a source, content and positive finite weight")
        }

        focus.push(Object.freeze({ source, content, weight: value.weight }))
    }

    return Object.freeze(focus)
}

function weightedTokens(focus: readonly MemoryFocus[]) {

    const weighted = new Map<string, number>()

    for (const signal of focus) {

        for (const token of tokens(signal.content)) {

            weighted.set(token, Math.min(4, (weighted.get(token) ?? 0) + signal.weight))
        }
    }

    return weighted
}

function documentFrequencies(candidates: readonly Candidate[]) {

    const frequencies = new Map<string, number>()

    for (const value of candidates) {

        for (const token of tokens(value.content)) {

            frequencies.set(token, (frequencies.get(token) ?? 0) + 1)
        }
    }

    return frequencies
}

function activation(
    content: string,
    focus: readonly MemoryFocus[],
    query: ReadonlyMap<string, number>,
    frequencies: ReadonlyMap<string, number>,
    documents: number,
    distance: number,
    memory?: MemoryActivation
) {

    const found = tokens(content)
    const matches: string[] = []
    let available = 0
    let matched = 0

    for (const [token, weight] of query) {

        const frequency = frequencies.get(token) ?? 0
        const specificity = Math.log(1 + (documents - frequency + 0.5) / (frequency + 0.5))
        const value = weight * specificity

        available += value

        if (found.has(token)) {

            matched += value
            matches.push(token)
        }
    }

    const lexical = available > 0 ? matched / available : 0
    const normalized = content.toLocaleLowerCase()
    const phrase = focus.reduce((strongest, signal) => {

        const value = signal.content.trim().toLocaleLowerCase()

        return value.length >= 4 && normalized.includes(value)
            ? Math.max(strongest, Math.min(1, signal.weight / 2))
            : strongest

    }, 0)
    const association = lexical + phrase * 0.25
    const temporal = 1 / (1 + Math.log2(1 + distance))
    const reinforcement = memory?.strength ?? 0

    return {
        association,
        temporal,
        reinforcement,
        retrievalCount: memory?.retrievalCount ?? 0,
        lastRetrievedAt: memory?.lastRetrievedAt ?? null,
        score: association + temporal * 0.15 + reinforcement * 0.25,
        matches: Object.freeze(matches)
    }
}

function tokens(value: string) {

    return new Set(value.toLocaleLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [])
}

function result(
    candidate: Candidate,
    selection: MemoryResult["selection"],
    perception: SelectionPerception
): MemoryResult {

    const operation = candidate.operation

    if (!operation.task) throw new Error("Memory selected an operation without a Task")

    return Object.freeze({
        sequence: operation.sequence,
        operation: operation.id,
        task: operation.task,
        parent: operation.parent,
        kind: operation.kind,
        content: candidate.content,
        source: candidate.source,
        method: candidate.method,
        tool: candidate.tool,
        call: candidate.call,
        selection,
        reason: perception.reason,
        score: perception.score,
        association: perception.association,
        reinforcement: perception.reinforcement,
        retrievalCount: perception.retrievalCount,
        lastRetrievedAt: perception.lastRetrievedAt,
        matches: perception.matches,
        anchor: perception.anchor,
        createdAt: operation.createdAt
    })
}

function record(value: unknown) {

    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null
}

function text(value: unknown) {

    return typeof value === "string" ? value : ""
}

function contextualText(value: unknown) {

    if (typeof value === "string") return value

    if (value === undefined || value === null) return ""

    return json(value)
}

function json(value: unknown): string {

    try {
        return JSON.stringify(value) ?? "undefined"
    } catch {
        return "[unserializable input]"
    }
}

function shorten(value: string, maximum: number) {

    return value.length <= maximum
        ? value
        : `${value.slice(0, Math.max(0, maximum - 1))}…`
}

function rounded(value: number) {

    return Math.round(value * 1_000) / 1_000
}

type Candidate = Readonly<{
    operation: Operation
    content: string
    source: string
    method: string
    tool: string | null
    call: string | null
}>

type Selected = Readonly<{
    value: Candidate
    selection: MemoryResult["selection"]
}> & SelectionPerception

type SelectionPerception = Readonly<{
    reason: MemoryResult["reason"]
    score: number
    association: number | null
    reinforcement: number
    retrievalCount: number
    lastRetrievedAt: number | null
    matches: readonly string[]
    anchor: string | null
}>

type Activation = Readonly<{
    association: number
    temporal: number
    reinforcement: number
    retrievalCount: number
    lastRetrievedAt: number | null
    score: number
    matches: readonly string[]
}>

type ContextIndex = Readonly<{
    tasks: ReadonlyMap<string, readonly Candidate[]>
    toolCalls: ReadonlyMap<string, Candidate>
}>

type TaskState = Readonly<{
    task: string
    status: TaskStatus
    objective: string
    origin: TaskOrigin
    initialModel: ModelIdentity | null
    activeModel: ModelIdentity | null
    execution: TaskExecution
    createdAt: number
    updatedAt: number
    endedAt: number | null
    sequence: number
    operations: readonly Operation[]
    candidates: readonly Candidate[]
}>

type TaskOrigin = Readonly<{
    type: "user" | "task"
    task: string | null
    call: string | null
}>

type ModelIdentity = Readonly<{
    provider: string
    id: string
}>

type TaskExecution = Readonly<{
    run: string | null
    reason: "created" | "continued" | null
    startedAt: number | null
    cycle: string | null
    cycleStartedAt: number | null
}>

type TaskAwareness = Readonly<{
    state: TaskState
    latest: Candidate | null
    sequence: number
}>

type TaskContinuity = Readonly<{
    state: TaskState
    distance: number
    operations: readonly Candidate[]
}>

type WorkingSignal = MemoryFocus & Readonly<{
    task: string
    operation: string
    method: string
    tool: string | null
    call: string | null
    createdAt: number
}>

type Awareness = Readonly<{
    tasks: readonly TaskAwareness[]
    omitted: number
}>

const terminalTaskStatuses = new Set<TaskStatus>(["cancelled", "completed", "failed"])
