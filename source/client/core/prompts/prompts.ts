import {
    promptReadySchema,
    promptRecordSchema,
    promptReleaseSchema,
    type PromptReady,
    type PromptResponse
} from "./contract"
import Prompt from "./prompt"

export interface PromptSource {
    open(listener: (value: unknown) => void): () => void
    release(listener: (value: unknown) => void): () => void
    respond(value: PromptResponse): void
    ready(value: PromptReady): void
}

/** Client Core's local collection of prompts awaiting a response. */
export default class Prompts {

    private readonly records = new Map<string, Prompt>()
    private readonly subscribers = new Set<() => void>()
    private cleanup: readonly (() => void)[] | null = null

    public constructor(private readonly source: PromptSource) {}

    public start() {

        if (this.cleanup) return

        this.cleanup = Object.freeze([
            this.source.open(value => this.receive(value)),
            this.source.release(value => this.release(value))
        ])

        this.source.ready(promptReadySchema.parse({ client: crypto.randomUUID() }))
    }

    public all(): readonly Prompt[] {

        return Object.freeze([...this.records.values()].sort((left, right) => left.createdAt - right.createdAt))
    }

    public forTask(task: string): readonly Prompt[] {

        return Object.freeze(this.all().filter(prompt => prompt.task === task))
    }

    public subscribe(subscriber: () => void) {

        this.subscribers.add(subscriber)

        return () => { this.subscribers.delete(subscriber) }
    }

    public stop() {

        if (!this.cleanup) return

        for (const cleanup of this.cleanup) cleanup()

        this.cleanup = null
        this.records.clear()
        this.changed()
    }

    private receive(value: unknown) {

        const parsed = promptRecordSchema.safeParse(value)

        if (!parsed.success || this.records.has(parsed.data.id)) return

        const prompt = new Prompt(
            parsed.data,
            response => this.source.respond(response),
            () => this.changed()
        )

        this.records.set(prompt.id, prompt)
        this.changed()
    }

    private release(value: unknown) {

        const parsed = promptReleaseSchema.safeParse(value)

        if (!parsed.success || !this.records.delete(parsed.data.id)) return

        this.changed()
    }

    private changed() {

        for (const subscriber of this.subscribers) subscriber()
    }
}
