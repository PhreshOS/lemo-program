import type LemoDatabase from "./database"
import {
    maximumContextOperations,
    maximumMemoryRetrievalBatch,
    maximumOperationPage
} from "./database"
import type {
    MemoryActivation,
    MemoryRetrievalInput,
    TaskMessage,
    TaskSummary
} from "./database"
import type LLMModel from "../llm/model"
import type Operation from "./operation"
import { taskStatus, type TaskStatus } from "./task"
import { estimatedTokens, tokenSlice } from "./token-budget"

export const defaultMemoryBudget = 8_000
export const minimumMemoryBudget = 256
export const maximumMemoryBudget = 16_000

const defaultPerceptualFieldTokens = 8_000
const defaultSemanticInformationTokens = 6_000
const defaultInboxTokens = 1_000
const unknownModelContextTokens = 65_536
const maximumBlockTokens = 1_024
const maximumWorkingSignals = 4
const maximumReinforcedCandidates = 128
const taskReadDefaultTokens = 8_000
const taskReadMaximumTokens = 16_000

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
    selection: "relevant"
    reason: "semantic-association"
    score: number
    association: number | null
    reinforcement: number
    retrievalCount: number
    lastRetrievedAt: number | null
    matches: readonly string[]
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

export type CycleContextBudgets = Readonly<{
    input: number
    perceptualField: number
    transcript: number
}>

/** Initial input uses at most 35% of capacity; ongoing Task input uses at most 70%. */
export async function cycleContextBudgets(
    model: Pick<LLMModel, "contextWindow">,
    phase: "initial" | "ongoing",
    requestOverhead = 0
): Promise<CycleContextBudgets> {

    const contextWindow = await model.contextWindow() ?? unknownModelContextTokens

    if (!Number.isSafeInteger(contextWindow) || contextWindow < 2) {
        throw new Error("An LLM Model returned an invalid context window")
    }

    const input = Math.floor(contextWindow * (phase === "initial" ? 35 : 70) / 100)
    const available = input - requestOverhead
    if (available < 2) throw new Error("The Model context window leaves no room for working context")
    const perceptualField = Math.max(1, Math.min(defaultPerceptualFieldTokens, Math.floor(available / 4)))

    return Object.freeze({
        input,
        perceptualField,
        transcript: Math.max(1, available - perceptualField)
    })
}

/** Owns every disposable projection from Lemo's raw operation history. */
export default class Context {

    public constructor(private readonly database: LemoDatabase) {}

    /** Rebuilds the disposable Perceptual Field for one Model cycle. */
    public async build(
        operations: readonly Operation[],
        perceptualFieldBudget = defaultPerceptualFieldTokens
    ): Promise<string> {

        const task = operations.find(operation => operation.task)?.task
        const now = Date.now()

        if (!task) throw new Error("A Perceptual Field requires a Task identity")

        const budgets = perceptualFieldBudgets(perceptualFieldBudget)
        const self = taskState(operations)
        const messages = await this.database.contextMessages(task)
        const focus = workingFocus(operations)
        const history = await this.history(self.objective, task, focus)
        const semantic = retrieve(history, {
            query: self.objective,
            focus,
            budget: budgets.semanticInformation
        }, await this.activations(history, now))

        // Automatic presentation is not evidence that a memory was useful.
        // Explicit recall records retrievals; building a cycle does not train recall.
        return perceptualField(self, semantic, messages, budgets)
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

        const validatedRequest = Object.freeze({
            ...request,
            budget: tokenBudget(
                request.budget ?? defaultMemoryBudget,
                minimumMemoryBudget,
                maximumMemoryBudget,
                "Memory recall"
            )
        })
        const now = Date.now()
        const operations = await this.history(
            validatedRequest.query,
            options.excludeTask,
            validatedRequest.focus ?? []
        )
        const results = retrieve(
            operations,
            validatedRequest,
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
        const history = taskHistoryXml(taskState(operations, summary), budget)

        return Object.freeze({
            task: summary,
            content: history.content,
            before: history.before ?? page.next,
            tokens: estimatedTokens(history.content)
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

    private async history(
        query: string,
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

        for (const operation of [...reinforced, ...recent, ...relevant]) {
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

        for (let index = 0; index < values.length; index += maximumMemoryRetrievalBatch) {
            await this.database.recordMemoryRetrievals(
                values.slice(index, index + maximumMemoryRetrievalBatch)
            )
        }

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
    memory: ReadonlyMap<string, MemoryActivation>
): readonly MemoryResult[] {

    const query = request.query.trim()
    if (!query) throw new Error("Memory recall requires a query")

    const budget = tokenBudget(request.budget ?? defaultMemoryBudget, 1, maximumMemoryBudget, "Memory retrieval")
    const candidates = operations.flatMap(candidate)
    if (!candidates.length) return Object.freeze([])

    const focus = recallFocus(query, request.focus ?? [])
    const queryTokens = weightedTokens(focus)
    const frequencies = documentFrequencies(candidates)
    const latest = candidates.at(-1)!.operation.sequence
    const ranked = candidates.map(value => ({
        value,
        ...activation(value.content, focus, queryTokens, frequencies, candidates.length,
            latest - value.operation.sequence, memory.get(value.operation.id))
    })).filter(value => value.association > 0).sort((left, right) => (
        right.semanticScore - left.semanticScore || right.value.operation.sequence - left.value.operation.sequence
    ))
    const selected: MemoryResult[] = []
    const contents = new Set<string>()
    let used = 0

    for (const entry of ranked) {
        const { value } = entry
        const identity = JSON.stringify([value.source, value.method, value.content.trim()])
        if (contents.has(identity)) continue

        const result = memoryResult({
            value,
            selection: "relevant",
            reason: "semantic-association",
            score: rounded(entry.semanticScore),
            association: rounded(entry.association),
            reinforcement: rounded(entry.reinforcement),
            retrievalCount: entry.retrievalCount,
            lastRetrievedAt: entry.lastRetrievedAt,
            matches: entry.matches
        })
        const addition = estimatedTokens(memoryOperation(result))
        if (used + addition > budget) continue

        selected.push(result)
        contents.add(identity)
        used += addition
    }

    return Object.freeze(selected)
}

function perceptualField(
    self: TaskState,
    semantic: readonly MemoryResult[],
    inbox: readonly TaskMessage[],
    budgets: PerceptualFieldBudgets
) {

    return [
        `<perceptual_field generatedAt="${timestamp(Date.now())}" budget="${budgets.total}" unit="estimated-tokens">`,
        "  <environment runtime=\"PhreshOS\" authority=\"server\" />",
        taskIdentityXml(self),
        memoryXml("semantic_memory", semantic, budgets.semanticInformation),
        inboxSection(inbox, budgets.inbox),
        "</perceptual_field>"
    ].join("\n")
}

type PerceptualFieldBudgets = Readonly<{
    total: number
    semanticInformation: number
    inbox: number
}>

function perceptualFieldBudgets(total: number): PerceptualFieldBudgets {

    if (!Number.isSafeInteger(total) || total < 1) {
        throw new Error("A Perceptual Field requires a positive token budget")
    }

    return Object.freeze({
        total: Math.min(total, defaultPerceptualFieldTokens),
        semanticInformation: proportionalBudget(total, defaultSemanticInformationTokens),
        inbox: proportionalBudget(total, defaultInboxTokens)
    })
}

function proportionalBudget(total: number, defaultBudget: number) {

    return Math.max(1, Math.floor(Math.min(total, defaultPerceptualFieldTokens) * defaultBudget / defaultPerceptualFieldTokens))
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
    const events = state.operations.flatMap(operation => taskHistoryEvents(state.task, operation))
    const selected: string[] = []
    let oldest: number | null = null
    let before: number | null = null
    let used = estimatedTokens([...fixed, "  <timeline>", "  </timeline>", "</task_history>"].join("\n"))

    for (let index = events.length - 1; index >= 0; index--) {
        const remaining = budget - used

        if (remaining < 32) {
            before = oldest
            break
        }

        let allowance = Math.min(maximumBlockTokens, remaining)
        let value = eventXml(events[index]!, allowance, "    ")
        // The budget includes XML attributes and escaping, not just event text.
        while (estimatedTokens(value) > remaining && allowance > 1) {
            allowance = Math.max(1, Math.floor(allowance / 2))
            value = eventXml(events[index]!, allowance, "    ")
        }
        const addition = estimatedTokens(value)

        if (used + addition > budget) {
            before = oldest
            break
        }

        selected.unshift(value)
        oldest = events[index]!.sequence
        used += addition
    }

    const content = [
        ...fixed,
        `  <timeline count="${selected.length}" omitted="${events.length - selected.length}">`,
        ...selected,
        "  </timeline>",
        "</task_history>"
    ].join("\n")
    return { content, before }
}

function taskHistoryEvents(task: string, operation: Operation): readonly TimelineEvent[] {

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
        return Object.freeze([timelineEvent(task, operation, "tool_result", contextualText(operation.payload), {
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

function memoryXml(name: "semantic_memory", results: readonly MemoryResult[], budget: number) {

    const values: string[] = []
    let used = estimatedTokens(`  <${name}></${name}>`)

    for (const result of results) {
        const value = memoryOperation(result)
        const addition = estimatedTokens(value)

        if (used + addition > budget) break

        values.push(value)
        used += addition
    }

    const selection = "semantic-relevance"
    const ranking = "semantic-relevance+reinforcement+recency"

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

function workingFocus(
    operations: readonly Operation[],
    maximum = maximumWorkingSignals
): readonly MemoryFocus[] {

    const focus: MemoryFocus[] = []

    for (let index = operations.length - 1; index >= 0 && focus.length < maximum; index--) {
        const operation = operations[index]!

        const payload = record(operation.payload)
        const content = operation.kind === "model.message" ? text(payload?.content)
            : operation.kind === "task.input" ? text(payload?.input) : ""
        for (const value of createCandidate(operation, tokenSlice(content, 256).content, "task", operation.kind)) {
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

    if (operation.kind === "tool.result") {
        const tool = text(payload?.name) || "unknown"
        return createCandidate(operation,
            payload?.ok === true ? payload.output : payload?.error,
            payload?.ok === true ? `tool:${tool}` : "runtime", "tool-result", tool, text(payload?.call) || null)
    }

    if (operation.kind === "task.failed") return createCandidate(operation, payload?.message, "lemo", "task-failure")

    if (operation.kind === "memory.recorded") return createCandidate(
        operation,
        memory?.content,
        text(memory?.source) || "unknown",
        text(memory?.method) || "memory-recorded",
        text(payload?.tool) || null,
        text(payload?.call) || null
    )

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

    // Normalize coverage by vocabulary size: a large catalog should not win
    // merely because it contains many generic query words among unrelated text.
    const lengthNormalization = Math.sqrt(Math.max(1, found.size / Math.max(1, query.size)))
    const lexical = available > 0 ? matched / available / lengthNormalization : 0
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

function tokens(value: string) {

    const normalized = value.toLocaleLowerCase().replace(/([\p{L}\p{N}_])['’]s\b/gu, "$1")
    return new Set(normalized.match(/[\p{L}\p{N}_]+/gu) ?? [])
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
