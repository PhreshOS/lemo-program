import type Operation from "@server/core/lemo/operation"
import type { TaskStatus } from "@server/core/lemo/task"
import {
    approvalRequestSchema,
    type ApprovalRequest
} from "@server/core/lemo/runtime/approval-contract"

export type ToolStatus = "running" | "waiting" | "completed" | "failed"
export type ToolSubscriber = (tool: Tool) => void

export type ToolControl = Readonly<{
    respond(response: unknown): Promise<void>
}>

export type ToolApproval = Readonly<{
    requestedBy: "lemo" | "tool"
    request: ApprovalRequest
    expiresAt: number
}>

export type ToolSnapshot = Readonly<{
    input: unknown
    output: unknown
    status: ToolStatus
    error: string | null
    approval: ToolApproval | null
    isResponding: boolean
    validationError: string | null
}>

/** One live Tool call owned by its Client Task. */
export default class Tool {

    private subscribers = new Set<ToolSubscriber>()
    private currentStatus: ToolStatus = "running"
    private currentInput: unknown
    private currentOutput: unknown = null
    private currentError: string | null = null
    private currentApproval: ToolApproval | null = null
    private responding = false
    private rejection: string | null = null
    private revision = 0
    private snapshotProjection!: ToolSnapshot

    public constructor(
        public readonly task: string,
        public readonly call: string,
        public readonly name: string,
        input: unknown,
        private readonly control: ToolControl
    ) {

        this.currentInput = input
        this.snapshotProjection = this.createSnapshot()
    }

    public get input() { return this.currentInput }
    public get output() { return this.currentOutput }
    public get status() { return this.currentStatus }
    public get error() { return this.currentError }
    public get approval() { return this.currentApproval }
    public get isResponding() { return this.responding }
    public get validationError() { return this.rejection }
    public get version() { return this.revision }

    public snapshot() { return this.snapshotProjection }

    public subscribe(subscriber: ToolSubscriber) {

        this.subscribers.add(subscriber)

        return () => { this.subscribers.delete(subscriber) }
    }

    public approve() {

        if (!this.currentApproval) throw new Error("This Tool is not awaiting approval")

        return this.respond({ type: "approved" })
    }

    public deny() {

        if (!this.currentApproval) throw new Error("This Tool is not awaiting approval")

        return this.respond({ type: "rejected" })
    }

    public synchronize(operations: readonly Operation[], taskStatus: TaskStatus) {

        const previous = this.projection()
        const normalized = operations.find(operation => {

            if (operation.kind !== "tool.input.normalized") return false

            return text(record(operation.payload)?.call) === this.call
        })
        const normalizedPayload = record(normalized?.payload)

        if (normalized && "input" in (normalizedPayload ?? {})) this.currentInput = normalizedPayload?.input

        const result = [...operations].reverse().find(operation => {

            if (operation.kind !== "tool.result") return false

            return text(record(operation.payload)?.call) === this.call
        })
        const resultPayload = record(result?.payload)
        const approval = latestCallOperation(operations, this.call, `tool.${this.name}.approval.requested`)
        const approvalResolution = latestCallOperation(operations, this.call, [
            `tool.${this.name}.approval.approved`,
            `tool.${this.name}.approval.rejected`
        ])

        this.currentApproval = !result && approval && (!approvalResolution || approvalResolution.sequence < approval.sequence)
            ? approvalRequest(approval.payload)
            : null

        if (result) {
            this.currentStatus = resultPayload?.ok === true ? "completed" : "failed"
            this.currentOutput = resultPayload?.ok === true ? resultPayload.output : null
            this.currentError = resultPayload?.ok === true
                ? null
                : text(resultPayload?.error) || "The Tool failed"
        } else if (this.currentApproval || this.waiting(operations)) {
            this.currentStatus = "waiting"
            this.currentError = null
        } else if (taskStatus === "running") {
            this.currentStatus = "running"
            this.currentError = null
        } else {
            this.currentStatus = "failed"
            this.currentError = "The Tool invocation is no longer running"
        }

        if (this.currentStatus !== "waiting") this.responding = false

        if (previous !== this.projection()) this.changed()
    }

    protected waiting(operations: readonly Operation[]) {

        return Boolean(latestCallOperation(operations, this.call, `tool.${this.name}.waiting`))
    }

    public async respond(response: unknown) {

        if (this.responding) throw new Error("This Client has already responded to the Tool")

        this.responding = true
        this.rejection = null
        this.changed()

        try {
            await this.control.respond(response)
        } catch (cause) {
            this.responding = false
            this.rejection = cause instanceof Error ? cause.message : String(cause)
            this.changed()

            throw cause
        }
    }

    private projection() {

        return JSON.stringify({
            input: this.currentInput,
            output: this.currentOutput,
            status: this.currentStatus,
            error: this.currentError,
            approval: this.currentApproval,
            responding: this.responding,
            rejection: this.rejection
        })
    }

    private changed() {

        this.revision++
        this.snapshotProjection = this.createSnapshot()

        for (const subscriber of this.subscribers) subscriber(this)
    }

    private createSnapshot(): ToolSnapshot {

        return Object.freeze({
            input: this.currentInput,
            output: this.currentOutput,
            status: this.currentStatus,
            error: this.currentError,
            approval: this.currentApproval,
            isResponding: this.responding,
            validationError: this.rejection
        })
    }
}

function latestCallOperation(
    operations: readonly Operation[],
    call: string,
    kinds: string | readonly string[]
) {

    const expected = new Set(typeof kinds === "string" ? [kinds] : kinds)

    return [...operations].reverse().find(operation => (
        expected.has(operation.kind)
        && text(record(operation.payload)?.call) === call
    )) ?? null
}

function approvalRequest(value: unknown): ToolApproval | null {

    const payload = record(record(value)?.payload)
    const request = record(payload?.request)
    const parsed = approvalRequestSchema.safeParse(request)
    const requestedBy = payload?.requestedBy
    const expiresAt = payload?.expiresAt

    if (
        !parsed.success
        || (requestedBy !== "lemo" && requestedBy !== "tool")
        || typeof expiresAt !== "number"
    ) return null

    return Object.freeze({
        requestedBy,
        request: Object.freeze(parsed.data),
        expiresAt
    })
}

function text(value: unknown) {

    return typeof value === "string" ? value : ""
}

function record(value: unknown) {

    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null
}
