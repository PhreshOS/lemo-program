import type LemoDatabase from "./database"
import type Operation from "./operation"

const defaultLimit = 20
const maximumLimit = 20

export type MemoryRecallRequest = Readonly<{
    query: string
    limit?: number
}>

export type MemoryResult = Readonly<{
    operation: string
    task: string
    parent: string | null
    kind: string
    content: string
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

    public async recall(request: MemoryRecallRequest): Promise<readonly MemoryResult[]> {

        const query = request.query.trim()

        if (!query) throw new Error("Memory recall requires a query")

        const limit = request.limit ?? defaultLimit

        if (!Number.isInteger(limit) || limit < 1 || limit > maximumLimit) {

            throw new Error(`Memory recall limit must be between 1 and ${maximumLimit}`)
        }

        const candidates = (await this.database.allOperations()).flatMap(candidate)

        if (!candidates.length) return Object.freeze([])

        const recentCount = Math.ceil(limit / 2)

        const recent = candidates.slice(-recentCount)

        const recentIdentities = new Set(recent.map(value => value.operation.id))

        const latest = candidates.at(-1)!.operation.sequence

        const queryTokens = tokens(query)

        const relevant = candidates
            .filter(value => !recentIdentities.has(value.operation.id))
            .map(value => ({ value, score: relevance(value.content, queryTokens, latest - value.operation.sequence) }))
            .filter(value => value.score > 0)
            .sort((left, right) => right.score - left.score || right.value.operation.sequence - left.value.operation.sequence)
            .slice(0, Math.max(0, limit - recent.length))
            .map(value => value.value)

        return Object.freeze([...recent, ...relevant]
            .sort((left, right) => left.operation.sequence - right.operation.sequence)
            .map(result))
    }
}

function candidate(operation: Operation): readonly Candidate[] {

    const payload = record(operation.payload)

    const content = operation.kind === "task.input"
        ? payload?.input
        : operation.kind === "model.message"
            ? payload?.content
            : operation.kind === "memory.recorded"
                ? record(payload?.record)?.content
                : undefined

    return typeof content === "string" && content.trim()
        ? [{ operation, content }]
        : []
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

function result(candidate: Candidate): MemoryResult {

    const operation = candidate.operation

    if (!operation.task) throw new Error("Memory selected an operation without a Task")

    return Object.freeze({
        operation: operation.id,
        task: operation.task,
        parent: operation.parent,
        kind: operation.kind,
        content: candidate.content,
        createdAt: operation.createdAt
    })
}

function record(value: unknown) {

    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null
}

type Candidate = Readonly<{
    operation: Operation
    content: string
}>
