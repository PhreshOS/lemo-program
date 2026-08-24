import Context from "./context"
import type {
    MemoryRecallOptions,
    MemoryRecallRequest,
    MemoryResult
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
    MemoryResult
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
        options: MemoryRecallOptions = {}
    ): Promise<readonly MemoryResult[]> {

        return this.builder.recall(request, options)
    }

    /** Rebuilds one Task's disposable model context entirely from durable operations. */
    public context(operations: readonly Operation[]): Promise<string> {

        return this.builder.build(operations)
    }
}
