import type LLMModel from "@client/core/llm/model"
import type OpenCodeProvider from "@client/core/llm/providers/opencode/provider"
import { default as OpenCodeProviderClass } from "@client/core/llm/providers/opencode/provider"
import type { LLMProviderState } from "@server/core/llm/provider"
import usePromise, { type PromiseWithDependencies } from "@libs/react-promise"
import type { LLMProviderViewProperties } from "../llm-providers"

export const identity = "opencode"

export default function OpenCodeConfiguration({ providers, models }: LLMProviderViewProperties) {

    const candidate = providers.get(identity)

    if (!(candidate instanceof OpenCodeProviderClass)) throw new Error("OpenCode Client Core is unavailable")

    const provider: OpenCodeProvider = candidate

    const resource = usePromise(() => provider.state(), [provider])

    const mutation = usePromise(async function (active: boolean) {

        if (active) await provider.activate()
        else await provider.deactivate()

        await resource.execute()

        await models.execute()
    })

    const state = resource.solve
    const failure = mutation.exception?.current ?? resource.exception?.current
    const pending = mutation.isPending || resource.isPending

    return <section className="provider-settings">
        <header>
            <div>
                <h2>{provider.name}</h2>
                <p>{providerStatus(resource, providerModelCount(models, provider.identity))}</p>
            </div>

            {state && <div className="actions">
                {state.active
                    ? <button
                        type="button"
                        disabled={pending}
                        onClick={() => void mutation.safeExecute(false)}
                    >Deactivate</button>
                    : <button
                        type="button"
                        disabled={pending}
                        onClick={() => void mutation.safeExecute(true)}
                    >Activate</button>}
            </div>}
        </header>

        <p>Anonymous public Models. No API key or billing configuration is required.</p>

        {pending && <p className="operation-state" role="status">Updating LLM Provider…</p>}

        {failure !== undefined && <div className="resource-error" role="alert">
            <p>{message(failure)}</p>
            <button type="button" disabled={pending} onClick={() => void resource.safeExecute()}>Retry</button>
        </div>}
    </section>
}

function providerStatus(resource: PromiseWithDependencies<LLMProviderState>, models: number) {

    if (resource.isPending) return "Loading state…"

    if (resource.exception) return "State unavailable"

    if (!resource.solve.active) return "Inactive"

    return `Active · ${models} free Models`
}

function message(value: unknown) {

    return value instanceof Error ? value.message : String(value)
}

function providerModelCount(resource: PromiseWithDependencies<readonly LLMModel[]>, provider: string) {

    return resource.solve?.filter(model => model.provider.identity === provider).length ?? 0
}
