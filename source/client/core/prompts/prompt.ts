import {
    promptResponseSchema,
    validatePromptValues,
    type PromptRecord,
    type PromptResponse,
    type PromptValue
} from "./contract"

/** One pending prompt represented locally by Client Core. */
export default class Prompt {

    private responding = false
    private rejection: string | null = null

    public constructor(
        private readonly record: PromptRecord,
        private readonly send: (response: PromptResponse) => void,
        private readonly changed: () => void
    ) {}

    public get id() { return this.record.id }
    public get task() { return this.record.task }
    public get call() { return this.record.call }
    public get request() { return this.record.request }
    public get createdAt() { return this.record.createdAt }
    public get expiresAt() { return this.record.expiresAt }
    public get isResponding() { return this.responding }
    public get validationError() { return this.rejection }

    public submit(values: Readonly<Record<string, PromptValue>>) {

        validatePromptValues(this.request, values)
        this.respond({ id: this.id, type: "submitted", values })
    }

    public cancel() {

        this.respond({ id: this.id, type: "cancelled" })
    }

    public fail(error: unknown) {

        const content = error instanceof Error ? error.message : String(error)

        this.respond({
            id: this.id,
            type: "failed",
            error: (content || "The interactive document failed").slice(0, 1_000)
        })
    }

    private respond(value: unknown) {

        if (this.responding) throw new Error("This Client has already responded to the prompt")

        const response = promptResponseSchema.parse(value)

        this.responding = true
        this.rejection = null
        this.changed()

        try {
            this.send(response)
        } catch (cause) {
            this.responding = false
            this.changed()

            throw cause
        }
    }

    /** Applies authoritative rejection while leaving this Prompt pending. */
    public reject(error: string) {

        this.responding = false
        this.rejection = error
        this.changed()
    }
}
