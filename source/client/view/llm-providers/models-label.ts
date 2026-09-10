import type LLMModel from "@client/core/llm/model"
import type { PromiseWithDependencies } from "@libs/react-promise"

/** An unresolved model catalog is not an empty catalog. */
export function modelsLabel(resource: PromiseWithDependencies<readonly LLMModel[]>, provider: string) {
    if (resource.isPending) return "Loading Models…"
    if (resource.exception || !resource.solve) return "Models unavailable"
    return `${resource.solve.filter(model => model.provider.identity === provider).length} Models`
}
