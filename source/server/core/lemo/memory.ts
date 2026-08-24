import type LemoDatabase from "./database"
import type Operation from "./operation"

export const defaultMemoryBudget = 12_000
export const minimumMemoryBudget = 1_000
export const maximumMemoryBudget = 32_000

export type MemoryRecallRequest = Readonly<{
    query: string
    budget?: number
}>

export type MemoryRecallOptions = Readonly<{
    excludeTask?: string
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
    selection: "recent" | "relevant" | "context"
    createdAt: number
}>

export type MemoryRecord = Readonly<{
    content: string
    source: string
    method: string
}>

export type MemoryRecordContext = Readonly<{
    task: string
    tool: string
    call: string
}>

/** Lemo's internal mathematical view over its raw operation history. */
export default class Memory {

    public constructor(private readonly database: LemoDatabase) {}

    /** Immediately persists one fact deliberately selected by a Tool. */
    public record(context: MemoryRecordContext, value: MemoryRecord): Promise<Operation> {

        if (!value.content.trim()) throw new Error("A Memory record requires content")

        if (!value.source.trim()) throw new Error("A Memory record requires a source")

        if (!value.method.trim()) throw new Error("A Memory record requires a recording method")

        return this.database.appendToTask(context.task, "memory.recorded", {
            tool: context.tool,
            call: context.call,
            record: value
        })
    }

    public async recall(
        request: MemoryRecallRequest,
        options: MemoryRecallOptions = {}
    ): Promise<readonly MemoryResult[]> {

        const query = request.query.trim()

        if (!query) throw new Error("Memory recall requires a query")

        const budget = request.budget ?? defaultMemoryBudget

        if (!Number.isInteger(budget) || budget < minimumMemoryBudget || budget > maximumMemoryBudget) {

            throw new Error(
                `Memory recall budget must be between ${minimumMemoryBudget} and ${maximumMemoryBudget} characters`
            )
        }

        const operations = (await this.database.allOperations())
            .filter(operation => operation.task !== options.excludeTask)
        const candidates = operations.flatMap(candidate)

        if (!candidates.length) return Object.freeze([])

        const index = contextIndex(operations, candidates)
        const selected = new Map<string, Selected>()
        let size = 0

        const include = (value: Candidate, selection: MemoryResult["selection"]) => {

            const existing = selected.get(value.operation.id)

            if (existing) {

                if (existing.selection === "context" && selection !== "context") {

                    selected.set(value.operation.id, { value, selection })
                }

                return true
            }

            const addition = contextSize(value)

            if (selected.size && size + addition > budget) return false

            selected.set(value.operation.id, { value, selection })
            size += addition

            return true
        }

        const collect = (
            anchors: readonly Candidate[],
            selection: "recent" | "relevant",
            target: number
        ) => {

            const identities = new Set<string>()

            for (const anchor of anchors) {

                if (size >= target) break
                if (!include(anchor, selection)) break

                identities.add(anchor.operation.id)

                for (const context of contextualUnit(anchor, index)) {

                    if (size >= target || !include(context, "context")) break
                }
            }

            return identities
        }

        const recentIdentities = collect(
            [...candidates].reverse(),
            "recent",
            Math.ceil(budget / 2)
        )

        const latest = candidates.at(-1)!.operation.sequence

        const queryTokens = tokens(query)

        const relevant = candidates
            .filter(value => !recentIdentities.has(value.operation.id))
            .map(value => ({ value, score: relevance(value.content, queryTokens, latest - value.operation.sequence) }))
            .filter(value => value.score > 0)
            .sort((left, right) => right.score - left.score || right.value.operation.sequence - left.value.operation.sequence)
            .map(value => value.value)

        collect(relevant, "relevant", budget)

        return Object.freeze([...selected.values()]
            .sort((left, right) => left.value.operation.sequence - right.value.operation.sequence)
            .map(value => result(value.value, value.selection)))
    }
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

    const content = text(value)

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
        candidates,
        positions: new Map(candidates.map((value, position) => [value.operation.id, position])),
        tasks,
        toolCalls
    }
}

function contextualUnit(anchor: Candidate, index: ContextIndex) {

    const values: Candidate[] = []
    const task = anchor.operation.task ? index.tasks.get(anchor.operation.task) ?? [] : []
    const taskPosition = task.findIndex(value => value.operation.id === anchor.operation.id)
    const globalPosition = index.positions.get(anchor.operation.id) ?? -1

    add(values, task.find(value => value.method === "task-input"))
    add(values, task[taskPosition - 1])
    add(values, task[taskPosition + 1])
    add(values, index.candidates[globalPosition - 1])
    add(values, index.candidates[globalPosition + 1])

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

function relevance(content: string, query: ReadonlySet<string>, distance: number) {

    if (!query.size) return 0

    const found = tokens(content)

    let overlap = 0

    for (const token of query) if (found.has(token)) overlap++

    const semantic = overlap / query.size

    const temporal = 1 / (1 + Math.log2(1 + distance))

    return semantic * temporal
}

function tokens(value: string) {

    return new Set(value.toLocaleLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [])
}

function result(candidate: Candidate, selection: MemoryResult["selection"]): MemoryResult {

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

function json(value: unknown): string {

    try {
        return JSON.stringify(value) ?? "undefined"
    } catch {
        return "[unserializable input]"
    }
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
}>

type ContextIndex = Readonly<{
    candidates: readonly Candidate[]
    positions: ReadonlyMap<string, number>
    tasks: ReadonlyMap<string, readonly Candidate[]>
    toolCalls: ReadonlyMap<string, Candidate>
}>
