/** Local projection of one authoritative Model's reasoning selection. */
export default class ModelReasoning {

    private current: string | null
    private transition = Promise.resolve()

    public constructor(
        reasoning: string | null,
        private readonly change: (level: string | null) => Promise<void>
    ) {

        this.current = reasoning
    }

    public get level() {

        return this.current
    }

    public synchronize(level: string | null) {

        this.current = level
    }

    public set(level: string | null) {

        const transition = this.transition.then(async () => {

            await this.change(level)

            this.current = level
        })

        this.transition = transition.catch(() => {})

        return transition
    }
}
