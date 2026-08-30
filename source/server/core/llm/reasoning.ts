import type { LLMReasoningLevels } from "./model"

/** Mutable reasoning selection for one retained Server Model. */
export default class ModelReasoning {

    private current: string | null
    private transition = Promise.resolve()

    public constructor(
        private readonly load: () => Promise<LLMReasoningLevels | null>,
        reasoning: string | null = null
    ) {

        this.current = reasoning
    }

    public get level() {

        return this.current
    }

    public levels() {

        return this.load()
    }

    public set(level: string | null) {

        const transition = this.transition.then(async () => {

            if (level !== null) validate(level, await this.load())

            this.current = level
        })

        this.transition = transition.catch(() => {})

        return transition
    }
}

function validate(level: string, available: LLMReasoningLevels | null) {

    if (!available) throw new Error("This LLM Model exposes no selectable reasoning levels")

    if (!available.levels.includes(level)) {
        throw new Error(`This LLM Model does not support reasoning level "${level}"`)
    }
}

export function sameReasoningLevels(left: LLMReasoningLevels | null, right: LLMReasoningLevels | null) {

    if (left === null || right === null) return left === right

    return left.default === right.default
        && left.required === right.required
        && left.levels.length === right.levels.length
        && left.levels.every((level, index) => level === right.levels[index])
}

export function compatibleReasoning(level: string | null, available: LLMReasoningLevels | null) {

    return level !== null && available?.levels.includes(level) ? level : null
}
