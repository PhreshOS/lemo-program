import type LemoDatabase from "./database"
import {
    maximumContextOperations,
    maximumOperationPage,
    maximumTaskContextBatch
} from "./database"
import type {
    MemoryActivation,
    MemoryRetrievalInput,
    TaskMessage,
    TaskSummary
} from "./database"
import type Operation from "./operation"
import { taskStatus, type TaskStatus } from "./task"
import { estimatedTokens, tokenSlice } from "./token-budget"

export const defaultMemoryBudget = 8_000
export const minimumMemoryBudget = 256
export const maximumMemoryBudget = 16_000

const perceptualFieldTokens = 50_000
const continuityTokens = 35_000
const semanticInformationTokens = 6_000
const rulesTokens = 4_000
const inboxTokens = 3_000
const maximumBlockTokens = 1_024
const maximumNearbyTasks = 8
const maximumContinuityTasks = 3
const maximumNearbyOperations = maximumOperationPage
const maximumReinforcedCandidates = 128
const maximumWorkingSignals = 12
const reinforcedMemoryThreshold = 0.6
const episodeReinforcementShare = 0.25
const taskReadDefaultTokens = 8_000
const taskReadMaximumTokens = 16_000
const taskMarkupOverhead = 96

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
    truncated: boolean
    tokens: number
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

export type TaskContextPage = Readonly<{
    task: TaskSummary
    content: string
    before: number | null
    tokens: number
}>

export type OperationBlockPage = Readonly<{
    task: string
    operation: string
    kind: string
    offset: number
    content: string
    next: number | null
    tokens: number
    totalTokens: number
}>

/** Owns every disposable projection from Lemo's raw operation history. */
export default class Context {

    public constructor(private readonly database: LemoDatabase) {}

    /** Rebuilds the disposable Perceptual Field for one Model cycle. */
    public async build(operations: readonly Operation[]): Promise<string> {

        const task = operations.find(operation => operation.task)?.task
        const now = Date.now()

        if (!task) throw new Error("A Perceptual Field requires a Task identity")

        const self = taskState(operations)
        const [nearby, messages] = await Promise.all([
            this.nearbyTasks(task),
            this.database.contextMessages(task)
        ])
        const focus = sharedMindFocus(self, nearby)
        const history = await this.history(self.objective, [], task, focus)
        const activations = await this.activations(history, now)
        const semantic = retrieve(history, {
            query: self.objective,
            focus,
            budget: semanticInformationTokens
        }, "semantic", activations)
        const semanticOperations = new Set(semantic.map(result => result.operation))
        const rules = retrieve(history, {
            query: self.objective,
            focus,
            budget: rulesTokens
        }, "rules", activations).filter(result => !semanticOperations.has(result.operation))
        const recorded = await this.record([...semantic, ...rules], {
            task,
            operation: operations.findLast(operation => operation.kind === "cycle.started")?.id
                ?? operations.at(-1)?.id
                ?? null,
            call: null,
            source: "context"
        }, now)
        const semanticIds = new Set(semantic.map(result => result.operation))

        return perceptualField(
            self,
            nearby,
            recorded.filter(result => semanticIds.has(result.operation)),
            recorded.filter(result => !semanticIds.has(result.operation)),
            messages
        )
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
            "recall",
            await this.activations(operations, now)
        )

        return this.record(results, origin, now)
    }

    /** Lazily reconstructs one Task as a source-labelled event history. */
    public async task(task: string, tokens = taskReadDefaultTokens, before?: number): Promise<TaskContextPage> {

        const budget = tokenBudget(tokens, minimumMemoryBudget, taskReadMaximumTokens, "Task read")
        const summary = await this.database.task(task)

        if (!summary) throw new Error(`Unknown Lemo Task "${task}"`)

        const page = await this.database.operations(task, {
            limit: maximumOperationPage,
            before,
            order: "newest",
            excludeKinds: ["model.event"]
        })
        const input = await this.database.firstOperation(task, "task.input")
        const operations = input && !page.operations.some(operation => operation.id === input.id)
            ? Object.freeze([input, ...page.operations])
            : page.operations
        const content = taskHistoryXml(taskState(operations, summary), budget)

        return Object.freeze({
            task: summary,
            content,
            before: page.next,
            tokens: estimatedTokens(content)
        })
    }

    /** Reads one complete raw operation through a bounded token page. */
    public async block(
        task: string,
        identity: string,
        offset = 0,
        tokens = maximumBlockTokens
    ): Promise<OperationBlockPage> {

        const budget = tokenBudget(tokens, minimumMemoryBudget, maximumMemoryBudget, "Block read")
        const operation = await this.database.operation(task, identity)

        if (!operation) throw new Error(`Unknown operation "${identity}" in Lemo Task "${task}"`)

        const page = tokenSlice(operationContent(operation), budget, offset)

        return Object.freeze({
            task,
            operation: identity,
            kind: operation.kind,
            offset,
            content: page.content,
            next: page.next,
            tokens: page.tokens,
            totalTokens: page.total
        })
    }

    private async nearbyTasks(self: string): Promise<readonly TaskState[]> {

        const [active, recent] = await Promise.all([
            this.database.tasks({
                limit: maximumNearbyTasks + 1,
                statuses: ["running", "paused"],
                order: "newest"
            }),
            this.database.tasks({ limit: maximumNearbyTasks + 1, order: "newest" })
        ])
        const summaries = new Map<string, TaskSummary>()

        for (const summary of [...active.tasks, ...recent.tasks]) {
            if (summary.id !== self && summaries.size < maximumNearbyTasks) summaries.set(summary.id, summary)
        }

        const states = await Promise.all([...summaries.values()].map(async summary => {
            const page = await this.database.operations(summary.id, {
                limit: maximumNearbyOperations,
                order: "newest",
                excludeKinds: ["model.event"]
            })
            const input = await this.database.firstOperation(summary.id, "task.input")
            const operations = input && !page.operations.some(operation => operation.id === input.id)
                ? Object.freeze([input, ...page.operations])
                : page.operations

            return taskState(operations, summary)
        }))

        return Object.freeze(states.sort((left, right) => (
            executionPriority(left.status) - executionPriority(right.status)
            || right.updatedAt - left.updatedAt
            || right.sequence - left.sequence
        )))
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
        )))].slice(0, maximumTaskContextBatch)

        for (const operation of await this.database.taskContextOperations(tasks)) {
            selected.set(operation.id, operation)
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

        const unique = [...new Map(results.map(result => [result.operation, result])).values()]
        const values: MemoryRetrievalInput[] = unique.map(result => ({
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
            unique.map(result => result.operation),
            retrievedAt
        )

        return Object.freeze(unique.map(result => {
            const activation = activations.get(result.operation)

            return activation ? Object.freeze({
                ...result,
                reinforcement: rounded(activation.strength),
                retrievalCount: activation.retrievalCount,
                lastRetrievedAt: activation.lastRetrievedAt
            }) : result
        }))
    }
}

function retrieve(
    operations: readonly Operation[],
    request: MemoryRecallRequest,
    mode: "semantic" | "rules" | "recall",
    memory: ReadonlyMap<string, MemoryActivation>
): readonly MemoryResult[] {

    const query = request.query.trim()

    if (!query) throw new Error("Memory recall requires a query")

    const budget = tokenBudget(
        request.budget ?? defaultMemoryBudget,
        minimumMemoryBudget,
        maximumMemoryBudget,
        "Memory recall"
    )
    const candidates = operations.flatMap(candidate)

    if (!candidates.length) return Object.freeze([])

    const index = contextIndex(operations, candidates)
    const focus = recallFocus(query, request.focus ?? [])
    const queryTokens = weightedTokens(focus)
    const frequencies = documentFrequencies(candidates)
    const latest = candidates.at(-1)!.operation.sequence
    const scored = candidates.map(value => ({
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
    const perceptions = new Map(scored.map(value => [value.value.operation.id, value]))
    const semantic = scored
        .filter(value => value.association > 0)
        .sort((left, right) => (
            right.semanticScore - left.semanticScore
            || right.association - left.association
            || right.value.operation.sequence - left.value.operation.sequence
        ))
    const rules = scored
        .filter(value => value.reinforcement >= reinforcedMemoryThreshold)
        .sort((left, right) => (
            right.ruleScore - left.ruleScore
            || right.reinforcement - left.reinforcement
            || right.value.operation.sequence - left.value.operation.sequence
        ))
    const selected = new Map<string, Selected>()
    let used = 0

    const include = (
        value: Candidate,
        selection: MemoryResult["selection"],
        anchor: string | null = null
    ) => {
        const existing = selected.get(value.operation.id)

        if (existing) {
            if (existing.selection === "context" && selection !== "context") {
                selected.set(value.operation.id, selectionPerception(
                    value,
                    selection,
                    perceptions.get(value.operation.id),
                    anchor,
                    anchor ? selected.get(anchor)?.score : undefined
                ))
            }

            return true
        }

        const addition = candidateTokens(value)

        if (used + addition > budget) return false

        selected.set(value.operation.id, selectionPerception(
            value,
            selection,
            perceptions.get(value.operation.id),
            anchor,
            anchor ? selected.get(anchor)?.score : undefined
        ))
        used += addition

        return true
    }
    const collect = (
        values: readonly (typeof scored)[number][],
        selection: "relevant" | "reinforced"
    ) => {
        for (const value of values) {
            if (!include(value.value, selection)) continue

            for (const supporting of episodeContext(value.value, index)) {
                include(supporting, "context", value.value.operation.id)
            }
        }
    }

    if (mode === "semantic") collect(semantic, "relevant")
    else if (mode === "rules") collect(rules, "reinforced")
    else {
        collect(semantic, "relevant")

        for (const recent of recentAnchors(index)) include(recent, "recent")

        collect(rules, "reinforced")
    }

    return Object.freeze([...selected.values()]
        .sort((left, right) => left.value.operation.sequence - right.value.operation.sequence)
        .map(value => memoryResult(value)))
}

function selectionPerception(
    value: Candidate,
    selection: MemoryResult["selection"],
    perception: Activation | undefined,
    anchor: string | null,
    anchorScore?: number
): Selected {

    const reinforcement = rounded(perception?.reinforcement ?? 0)
    const common = {
        value,
        selection,
        reinforcement,
        retrievalCount: perception?.retrievalCount ?? 0,
        lastRetrievedAt: perception?.lastRetrievedAt ?? null
    }

    if (selection === "relevant") return Object.freeze({
        ...common,
        reason: "semantic-association",
        score: rounded(perception?.semanticScore ?? 0),
        association: perception ? rounded(perception.association) : null,
        matches: Object.freeze(perception?.matches ?? []),
        anchor: null
    })

    if (selection === "reinforced") return Object.freeze({
        ...common,
        reason: "reinforced-memory",
        score: rounded(perception?.ruleScore ?? 0),
        association: perception ? rounded(perception.association) : null,
        matches: Object.freeze(perception?.matches ?? []),
        anchor: null
    })

    if (selection === "recent") return Object.freeze({
        ...common,
        reason: "explicit-recent",
        score: rounded(perception?.semanticScore ?? 0),
        association: null,
        matches: Object.freeze([]),
        anchor: null
    })

    return Object.freeze({
        ...common,
        reason: "episode-context",
        score: rounded((anchorScore ?? perception?.semanticScore ?? 0) * episodeReinforcementShare),
        association: null,
        matches: Object.freeze([]),
        anchor
    })
}

function perceptualField(
    self: TaskState,
    nearby: readonly TaskState[],
    semantic: readonly MemoryResult[],
    rules: readonly MemoryResult[],
    inbox: readonly TaskMessage[]
) {

    return [
        `<perceptual_field generatedAt="${timestamp(Date.now())}" budget="${perceptualFieldTokens}" unit="estimated-tokens">`,
        "  <environment runtime=\"PhreshOS\" authority=\"server\" />",
        taskIdentityXml(self),
        continuityXml(nearby, continuityTokens),
        memoryXml("semantic_memory", semantic, semanticInformationTokens),
        memoryXml("rules", rules, rulesTokens),
        inboxSection(inbox, inboxTokens),
        "</perceptual_field>"
    ].join("\n")
}

function taskIdentityXml(state: TaskState) {

    return [
        `  <task ${taskAttributes(state)}>`,
        `    <origin ${originAttributes(state.origin)} />`,
        `    <execution ${executionAttributes(state.execution)} />`,
        "    <models>",
        `      <llm_model role="active" ${modelAttributes(state.activeModel)} />`,
        `      <llm_model role="initial" ${modelAttributes(state.initialModel)} />`,
        "    </models>",
        "  </task>"
    ].join("\n")
}

function continuityXml(states: readonly TaskState[], budget: number) {

    const descriptors: string[] = []
    const included: TaskState[] = []
    let used = estimatedTokens("  <continuity><tasks></tasks><timeline></timeline></continuity>")

    for (const state of states) {
        const input = state.operations.find(operation => operation.kind === "task.input")

        if (!input) continue

        const remaining = budget - used

        if (remaining < 32) break

        const objective = xmlBlock(
            input,
            "objective",
            state.objective,
            Math.min(maximumBlockTokens, remaining),
            "      "
        )
        const value = [
            `    <task ${taskAttributes(state)}>`,
            `      <origin ${originAttributes(state.origin)} />`,
            objective,
            "    </task>"
        ].join("\n")
        const addition = estimatedTokens(value)

        if (used + addition > budget) break

        descriptors.push(value)
        included.push(state)
        used += addition
    }

    const events = included
        .flatMap(state => state.operations.flatMap(operation => continuityEvents(state.task, operation)))
        .sort((left, right) => left.sequence - right.sequence)
    const selected: string[] = []

    for (let index = events.length - 1; index >= 0; index--) {
        const event = events[index]!
        const remaining = budget - used

        if (remaining < 32) break

        const value = eventXml(event, Math.min(maximumBlockTokens, remaining), "    ")
        const addition = estimatedTokens(value)

        if (used + addition > budget) continue

        selected.unshift(value)
        used += addition
    }

    return [
        `  <continuity budget="${budget}" unit="estimated-tokens" tasks="${descriptors.length}" events="${selected.length}" omittedTasks="${states.length - descriptors.length}" omittedEvents="${events.length - selected.length}">`,
        "    <tasks>",
        ...descriptors,
        "    </tasks>",
        "    <timeline>",
        ...selected,
        "    </timeline>",
        "  </continuity>"
    ].join("\n")
}

function taskHistoryXml(state: TaskState, budget: number) {

    const input = state.operations.find(operation => operation.kind === "task.input")

    if (!input) throw new Error("A Task context requires its input block")

    const objective = xmlBlock(input, "objective", state.objective, maximumBlockTokens, "  ")
    const fixed = [
        `<task_history ${taskAttributes(state)} budget="${budget}" unit="estimated-tokens">`,
        `  <origin ${originAttributes(state.origin)} />`,
        `  <execution ${executionAttributes(state.execution)} />`,
        "  <models>",
        `    <llm_model role="active" ${modelAttributes(state.activeModel)} />`,
        `    <llm_model role="initial" ${modelAttributes(state.initialModel)} />`,
        "  </models>",
        objective
    ]
    const events = state.operations.flatMap(operation => continuityEvents(state.task, operation))
    const selected: string[] = []
    let used = estimatedTokens([...fixed, "  <timeline>", "  </timeline>", "</task_history>"].join("\n"))

    for (let index = events.length - 1; index >= 0; index--) {
        const remaining = budget - used

        if (remaining < 32) break

        const value = eventXml(events[index]!, Math.min(maximumBlockTokens, remaining), "    ")
        const addition = estimatedTokens(value)

        if (used + addition > budget) continue

        selected.unshift(value)
        used += addition
    }

    return [
        ...fixed,
        `  <timeline count="${selected.length}" omitted="${events.length - selected.length}">`,
        ...selected,
        "  </timeline>",
        "</task_history>"
    ].join("\n")
}

function continuityEvents(task: string, operation: Operation): readonly TimelineEvent[] {

    const payload = record(operation.payload)

    if (operation.kind === "model.message") {
        const content = typeof payload?.content === "string" ? payload.content : ""
        const calls = Array.isArray(payload?.toolCalls) ? payload.toolCalls : []

        return Object.freeze([
            ...(content ? [timelineEvent(task, operation, "assistant", content, { source: "lemo" })] : []),
            ...calls.flatMap(value => {
                const call = record(value)

                return call ? [timelineEvent(task, operation, "tool_call", contextualText(call.input), {
                    call: text(call?.id),
                    tool: text(call?.name)
                })] : []
            })
        ])
    }

    if (operation.kind === "tool.result") {
        const contextual = payload?.ok === true && "modelOutput" in payload
            ? {
                call: payload.call,
                name: payload.name,
                ok: true,
                output: payload.modelOutput
            }
            : operation.payload

        return Object.freeze([timelineEvent(task, operation, "tool_result", contextualText(contextual), {
            call: text(payload?.call),
            tool: text(payload?.name),
            ok: String(payload?.ok === true)
        })])
    }

    if (operation.kind === "memory.recorded") {
        const value = record(payload?.record)

        return Object.freeze([timelineEvent(task, operation, "memory", contextualText(value?.content), {
            source: text(value?.source),
            method: text(value?.method),
            tool: text(payload?.tool),
            call: text(payload?.call)
        })])
    }

    if (operation.kind === "task.failed") {
        return Object.freeze([timelineEvent(task, operation, "failure", contextualText(operation.payload))])
    }

    return Object.freeze([])
}

function timelineEvent(
    task: string,
    operation: Operation,
    element: TimelineEvent["element"],
    content: string,
    attributes: Readonly<Record<string, string>> = {}
): TimelineEvent {

    return Object.freeze({ task, operation, element, content, attributes, sequence: operation.sequence })
}

function eventXml(event: TimelineEvent, budget: number, indentation: string) {

    return xmlBlock(event.operation, event.element, event.content, budget, indentation, {
        task: event.task,
        ...event.attributes
    })
}

function memoryXml(name: "semantic_memory" | "rules", results: readonly MemoryResult[], budget: number) {

    const values: string[] = []
    let used = estimatedTokens(`  <${name}></${name}>`)

    for (const result of results) {
        const value = memoryOperation(result)
        const addition = estimatedTokens(value)

        if (used + addition > budget) break

        values.push(value)
        used += addition
    }

    const selection = name === "semantic_memory" ? "semantic-relevance" : "reinforcement"
    const ranking = name === "semantic_memory"
        ? "semantic-relevance+reinforcement+recency"
        : "reinforcement+semantic-relevance+recency"

    return [
        `  <${name} budget="${budget}" unit="estimated-tokens" selection="${selection}" ranking="${ranking}" count="${values.length}" omitted="${results.length - values.length}">`,
        ...values,
        `  </${name}>`
    ].join("\n")
}

function inboxSection(messages: readonly TaskMessage[], budget: number) {

    const values: string[] = []
    let used = estimatedTokens("  <inbox></inbox>")

    for (let index = messages.length - 1; index >= 0; index--) {
        const message = messages[index]!
        const slice = tokenSlice(message.message, Math.min(maximumBlockTokens, Math.max(1, budget - used)))
        const attributes = [
            ["id", message.id],
            ["event", message.event],
            ["sourceTask", message.sourceTask],
            ["sourceCall", message.sourceCall],
            ["createdAt", timestamp(message.createdAt)],
            ["deliveredAt", message.deliveredAt === null ? "" : timestamp(message.deliveredAt)],
            ["delivery", message.deliveredAt === null ? "new" : "previously-delivered"],
            ["tokens", String(slice.total)],
            ["truncated", String(slice.next !== null)]
        ].map(([name, value]) => `${name}="${xml(value)}"`).join(" ")
        const value = `    <message ${attributes}>${xml(slice.content)}</message>`
        const addition = estimatedTokens(value)

        if (used + addition > budget) break

        values.unshift(value)
        used += addition
    }

    return [
        `  <inbox budget="${budget}" unit="estimated-tokens" count="${values.length}" omitted="${messages.length - values.length}">`,
        ...values,
        "  </inbox>"
    ].join("\n")
}

function memoryOperation(result: MemoryResult) {

    const attributes = [
        ["task", result.task],
        ["operation", result.operation],
        ["sequence", String(result.sequence)],
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
        ["semanticRelevance", result.association === null ? "" : String(result.association)],
        ["reinforcement", String(result.reinforcement)],
        ["retrievalCount", String(result.retrievalCount)],
        ["lastRetrievedAt", result.lastRetrievedAt === null ? "" : timestamp(result.lastRetrievedAt)],
        ["matches", result.matches.join(",")],
        ["anchor", result.anchor ?? ""],
        ["tokens", String(result.tokens)],
        ["truncated", String(result.truncated)]
    ].map(([name, value]) => `${name}="${xml(value)}"`).join(" ")

    return `    <information ${attributes}>${xml(result.content)}</information>`
}

function xmlBlock(
    operation: Operation,
    element: string,
    content: string,
    budget: number,
    indentation: string,
    extra: Readonly<Record<string, string>> = {}
) {

    const slice = tokenSlice(content, Math.max(1, Math.min(maximumBlockTokens, budget)))
    const attributes = [
        ["operation", operation.id],
        ["sequence", String(operation.sequence)],
        ["kind", operation.kind],
        ["createdAt", timestamp(operation.createdAt)],
        ["tokens", String(slice.total)],
        ["truncated", String(slice.next !== null)],
        ...Object.entries(extra)
    ].map(([name, value]) => `${name}="${xml(value)}"`).join(" ")
    const retrieval = slice.next === null
        ? ""
        : ` retrieve="tasks.read_block" next="${slice.next}"`

    return `${indentation}<${element} ${attributes}${retrieval}>${xml(slice.content)}</${element}>`
}

function taskState(operations: readonly Operation[], summary?: TaskSummary): TaskState {

    const ordered = [...operations].sort((left, right) => left.sequence - right.sequence)
    const input = ordered.find(operation => operation.kind === "task.input")
    const inputPayload = record(input?.payload)

    if (!input?.task || typeof inputPayload?.input !== "string" || !inputPayload.input.trim()) {
        throw new Error("A Task context requires its durable input")
    }

    const source = record(inputPayload.source)
    const sourceTask = text(source?.task) || null
    const sourceCall = text(source?.call) || null
    const origin: TaskOrigin = source?.type === "task" && sourceTask && sourceCall
        ? Object.freeze({ type: "task", task: sourceTask, call: sourceCall })
        : Object.freeze({ type: "user", task: null, call: null })
    const initialModel = modelIdentity(inputPayload.model)
    const run = ordered.findLast(operation => operation.kind === "task.run.started")
    const runPayload = record(run?.payload)
    const cycle = ordered.findLast(operation => operation.kind === "cycle.started")
    const cyclePayload = record(cycle?.payload)
    const activeModel = modelIdentity(cyclePayload?.model)
        ?? modelIdentity(runPayload?.model)
        ?? initialModel
    const status = summary?.status ?? taskStatus(ordered)
    const updatedAt = summary?.updatedAt ?? ordered.at(-1)?.createdAt ?? input.createdAt

    return Object.freeze({
        task: input.task,
        status,
        objective: inputPayload.input,
        origin,
        initialModel,
        activeModel,
        execution: Object.freeze({
            run: text(runPayload?.run) || null,
            reason: runPayload?.reason === "created" || runPayload?.reason === "continued"
                ? runPayload.reason
                : null,
            startedAt: run?.createdAt ?? null,
            cycle: cycle?.id ?? null,
            cycleStartedAt: cycle?.createdAt ?? null
        }),
        createdAt: summary?.createdAt ?? input.createdAt,
        updatedAt,
        endedAt: terminalTaskStatuses.has(status) ? updatedAt : null,
        sequence: input.sequence,
        operations: Object.freeze(ordered)
    })
}

function taskAttributes(state: TaskState) {

    return [
        ["id", state.task],
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
        ["cycleStartedAt", execution.cycleStartedAt === null ? "" : timestamp(execution.cycleStartedAt)]
    ].map(([name, value]) => `${name}="${xml(value)}"`).join(" ")
}

function modelAttributes(model: ModelIdentity | null) {

    return [
        ["provider", model?.provider ?? ""],
        ["id", model?.id ?? ""]
    ].map(([name, value]) => `${name}="${xml(value)}"`).join(" ")
}

function modelIdentity(value: unknown): ModelIdentity | null {

    const model = record(value)

    return typeof model?.provider === "string" && typeof model.id === "string"
        ? Object.freeze({ provider: model.provider, id: model.id })
        : null
}

function sharedMindFocus(self: TaskState, nearby: readonly TaskState[]): readonly MemoryFocus[] {

    const focus = [...workingFocus(self.operations, 8)]
    const continuity = [...nearby].sort((left, right) => (
        right.updatedAt - left.updatedAt || right.sequence - left.sequence
    ))

    for (
        let index = 0;
        index < Math.min(continuity.length, maximumContinuityTasks) && focus.length < maximumWorkingSignals;
        index++
    ) {
        const state = continuity[index]!
        const weight = 0.75 / (1 + index * 0.25)

        for (const signal of workingFocus(state.operations, 2)) {
            if (focus.length >= maximumWorkingSignals) break

            focus.push(Object.freeze({
                source: `nearby-task:${state.task}:${signal.source}`,
                content: signal.content,
                weight: signal.weight * weight
            }))
        }
    }

    return Object.freeze(focus)
}

function workingFocus(
    operations: readonly Operation[],
    maximum = maximumWorkingSignals
): readonly MemoryFocus[] {

    const focus: MemoryFocus[] = []

    for (let index = operations.length - 1; index >= 0 && focus.length < maximum; index--) {
        const operation = operations[index]!

        for (const value of candidate(operation)) {
            focus.push(Object.freeze({
                source: `${value.source}:${value.method}`,
                content: value.content,
                weight: 2 / (1 + focus.length * 0.15)
            }))
        }
    }

    return Object.freeze(focus.reverse())
}

function candidate(operation: Operation): readonly Candidate[] {

    const payload = record(operation.payload)
    const memory = record(payload?.record)

    if (operation.kind === "task.input") return createCandidate(operation, payload?.input, "user", "task-input")
    if (operation.kind === "model.message") return createCandidate(operation, payload?.content, "lemo", "model-message")

    if (operation.kind === "memory.recorded") return createCandidate(
        operation,
        memory?.content,
        text(memory?.source) || "unknown",
        text(memory?.method) || "memory-recorded",
        text(payload?.tool) || null,
        text(payload?.call) || null
    )

    if (operation.kind === "tool.result" && payload?.ok === true && "modelOutput" in payload) {
        const tool = text(payload.name) || "unknown"

        return createCandidate(
            operation,
            payload.modelOutput,
            `tool:${tool}`,
            "tool-result",
            tool,
            text(payload.call) || null
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

        return createCandidate(operation, error ? `Task failed: ${error}` : "Task failed", "lemo", "task-failure")
    }

    return Object.freeze([])
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

    return content.trim() ? [Object.freeze({ operation, content, source, method, tool, call })] : Object.freeze([])
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

    return { tasks, toolCalls }
}

function episodeContext(anchor: Candidate, index: ContextIndex) {

    const values: Candidate[] = []
    const task = anchor.operation.task ? index.tasks.get(anchor.operation.task) ?? [] : []
    const position = task.findIndex(value => value.operation.id === anchor.operation.id)

    add(values, task.find(value => value.method === "task-input"))
    add(values, task[position - 1])
    add(values, task[position + 1])

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

    return id && tool ? Object.freeze({
        operation,
        content: `Tool ${tool} requested with input: ${contextualText(call?.input)}`,
        source: "lemo",
        method: "tool-call",
        tool,
        call: id
    }) : null
}

function recentAnchors(index: ContextIndex) {

    return [...index.tasks.values()]
        .map(task => task.at(-1))
        .filter((value): value is Candidate => value !== undefined)
        .sort((left, right) => right.operation.sequence - left.operation.sequence)
}

function activation(
    content: string,
    focus: readonly MemoryFocus[],
    query: ReadonlyMap<string, number>,
    frequencies: ReadonlyMap<string, number>,
    documents: number,
    distance: number,
    memory?: MemoryActivation
): Activation {

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

    return Object.freeze({
        association,
        temporal,
        reinforcement,
        retrievalCount: memory?.retrievalCount ?? 0,
        lastRetrievedAt: memory?.lastRetrievedAt ?? null,
        semanticScore: association + reinforcement * 0.25 + temporal * 0.15,
        ruleScore: reinforcement + association * 0.25 + temporal * 0.15,
        matches: Object.freeze(matches)
    })
}

function memoryResult(selected: Selected): MemoryResult {

    const operation = selected.value.operation

    if (!operation.task) throw new Error("Memory selected an operation without a Task")

    const slice = tokenSlice(selected.value.content, maximumBlockTokens)

    return Object.freeze({
        sequence: operation.sequence,
        operation: operation.id,
        task: operation.task,
        parent: operation.parent,
        kind: operation.kind,
        content: slice.content,
        truncated: slice.next !== null,
        tokens: slice.total,
        source: selected.value.source,
        method: selected.value.method,
        tool: selected.value.tool,
        call: selected.value.call,
        selection: selected.selection,
        reason: selected.reason,
        score: selected.score,
        association: selected.association,
        reinforcement: selected.reinforcement,
        retrievalCount: selected.retrievalCount,
        lastRetrievedAt: selected.lastRetrievedAt,
        matches: selected.matches,
        anchor: selected.anchor,
        createdAt: operation.createdAt
    })
}

function recallFocus(query: string, values: readonly MemoryFocus[]) {

    const focus: MemoryFocus[] = [{ source: "task-objective", content: query, weight: 1 }]

    for (const value of values) {
        if (!value.content.trim() || !value.source.trim() || !Number.isFinite(value.weight) || value.weight <= 0) {
            throw new Error("Memory focus signals require a source, content and positive finite weight")
        }

        focus.push(Object.freeze({ source: value.source.trim(), content: value.content.trim(), weight: value.weight }))
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
        for (const token of tokens(value.content)) frequencies.set(token, (frequencies.get(token) ?? 0) + 1)
    }

    return frequencies
}

function candidateTokens(candidate: Candidate) {

    return Math.min(maximumBlockTokens, estimatedTokens(candidate.content)) + taskMarkupOverhead
}

function operationContent(operation: Operation) {

    return JSON.stringify({
        task: operation.task,
        operation: operation.id,
        sequence: operation.sequence,
        parent: operation.parent,
        kind: operation.kind,
        createdAt: timestamp(operation.createdAt),
        payload: operation.payload
    }, null, 2)
}

function contextualText(value: unknown) {

    if (typeof value === "string") return value
    if (value === undefined || value === null) return ""

    try {
        return JSON.stringify(value) ?? "undefined"
    } catch {
        return "[unserializable input]"
    }
}

function tokenBudget(value: number, minimum: number, maximum: number, name: string) {

    if (!Number.isInteger(value) || value < minimum || value > maximum) {
        throw new Error(`${name} budget must be between ${minimum} and ${maximum} estimated tokens`)
    }

    return value
}

function executionPriority(status: TaskStatus) {

    return status === "running" ? 0 : status === "paused" ? 1 : 2
}

function add(values: Candidate[], value: Candidate | undefined) {

    if (value && !values.some(candidate => candidate.operation.id === value.operation.id)) values.push(value)
}

function tokens(value: string) {

    return new Set(value.toLocaleLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [])
}

function record(value: unknown) {

    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null
}

function text(value: unknown) {

    return typeof value === "string" ? value : ""
}

function rounded(value: number) {

    return Math.round(value * 1_000) / 1_000
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

type Candidate = Readonly<{
    operation: Operation
    content: string
    source: string
    method: string
    tool: string | null
    call: string | null
}>

type Activation = Readonly<{
    association: number
    temporal: number
    reinforcement: number
    retrievalCount: number
    lastRetrievedAt: number | null
    semanticScore: number
    ruleScore: number
    matches: readonly string[]
}>

type Selected = Readonly<{
    value: Candidate
    selection: MemoryResult["selection"]
    reason: MemoryResult["reason"]
    score: number
    association: number | null
    reinforcement: number
    retrievalCount: number
    lastRetrievedAt: number | null
    matches: readonly string[]
    anchor: string | null
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

type TimelineEvent = Readonly<{
    task: string
    operation: Operation
    element: "assistant" | "tool_call" | "tool_result" | "memory" | "failure"
    content: string
    attributes: Readonly<Record<string, string>>
    sequence: number
}>

const terminalTaskStatuses = new Set<TaskStatus>(["cancelled", "completed", "failed"])
