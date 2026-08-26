import Context from "./context"
import type {
    MemoryRecallOptions,
    MemoryRecallRequest,
    MemoryRetrievalOrigin,
    MemoryResult,
    OperationBlockPage,
    TaskContextPage
} from "./context"
import type LemoDatabase from "./database"
import type Operation from "./operation"

export {
    defaultMemoryBudget,
    maximumMemoryBudget,
    minimumMemoryBudget
} from "./context"

export type {
    MemoryFocus,
    MemoryRecallOptions,
    MemoryRecallRequest,
    MemoryResult,
    OperationBlockPage,
    TaskContextPage
} from "./context"

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

/** Lemo's internal Memory contract; retrieval and context assembly remain replaceable. */
export default class Memory {
    private readonly builder: Context

    public constructor(private readonly database: LemoDatabase) {

        this.builder = new Context(database)
    }

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

    public recall(
        request: MemoryRecallRequest,
        options: MemoryRecallOptions = {},
        origin?: MemoryRetrievalOrigin
    ): Promise<readonly MemoryResult[]> {

        return this.builder.recall(request, options, origin)
    }

    /** Rebuilds one Task's disposable model context entirely from durable operations. */
    public context(operations: readonly Operation[]): Promise<string> {

        return this.builder.build(operations)
    }

    /** Lazily reconstructs one Task through the Perceptual Field's Task shape. */
    public task(task: string, tokens?: number, before?: number): Promise<TaskContextPage> {

        return this.builder.task(task, tokens, before)
    }

    /** Lazily reads one raw durable operation without loading its whole Task. */
    public block(task: string, operation: string, offset?: number, tokens?: number): Promise<OperationBlockPage> {

        return this.builder.block(task, operation, offset, tokens)
    }
}
