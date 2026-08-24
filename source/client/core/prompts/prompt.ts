import { promptResponseSchema, type PromptRecord, type PromptResponse } from "./contract"

/** One pending prompt represented locally by Client Core. */
export default class Prompt {

    private responding = false

    public constructor(
        private readonly record: PromptRecord,
        private readonly send: (response: PromptResponse) => void,
        private readonly changed: () => void
    ) {}

    public get id() { return this.record.id }
    public get task() { return this.record.task }
    public get call() { return this.record.call }
    public get content() { return this.record.content }
    public get createdAt() { return this.record.createdAt }
    public get expiresAt() { return this.record.expiresAt }
    public get isResponding() { return this.responding }

    public respond(content: string) {

        if (this.responding) throw new Error("This Client has already responded to the prompt")

        const response = promptResponseSchema.parse({ id: this.id, content })

        this.responding = true
        this.changed()

        try {
            this.send(response)
        } catch (cause) {
            this.responding = false
            this.changed()

            throw cause
        }
    }
}
