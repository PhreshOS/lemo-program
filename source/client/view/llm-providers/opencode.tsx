import { Button, Surface } from "@phreshos/react-ui"
import { modelsLabel } from "./models-label"
import type OpenCodeProvider from "@client/core/llm/providers/opencode/provider"
import { default as OpenCodeProviderClass } from "@client/core/llm/providers/opencode/provider"
import type { LLMProviderState } from "@server/core/llm/provider"
import usePromise, { type PromiseWithDependencies } from "@libs/react-promise"
import type { LLMProviderViewProperties } from "../llm-providers"
import useProviderRevision from "../use-provider-revision"

export const identity = "opencode"

export default function OpenCodeConfiguration({ providers, models }: LLMProviderViewProperties) {

    const candidate = providers.get(identity)

    if (!(candidate instanceof OpenCodeProviderClass)) throw new Error("OpenCode Client Core is unavailable")

    const provider: OpenCodeProvider = candidate

    const revision = useProviderRevision(providers)
    const resource = usePromise(() => provider.state(), [provider, revision])

    const mutation = usePromise(async function (active: boolean) {

        if (active) await provider.activate()
        else await provider.deactivate()

    })

    const state = resource.solve
    const failure = mutation.exception?.current ?? resource.exception?.current
    const pending = mutation.isPending || resource.isPending

    return <Surface className="provider-settings">
        <div className="provider-heading">
            <div>
                <h2>{provider.name}</h2>
                <p>{providerStatus(resource, modelsLabel(models, provider.identity))}</p>
            </div>

            {state && <div className="actions">
                {state.active
                    ? <Button size="small"
                        type="button"
                        disabled={pending}
                        onPress={() => void mutation.safeExecute(false)}
                    >Deactivate</Button>
                    : <Button size="small"
                        type="button"
                        disabled={pending}
                        onPress={() => void mutation.safeExecute(true)}
                    >Activate</Button>}
            </div>}
        </div>

        <p>Anonymous public Models. No API key or billing configuration is required.</p>

        {pending && <p className="operation-state" role="status">Updating LLM Provider…</p>}

        {failure !== undefined && <div className="resource-error" role="alert">
            <p>{message(failure)}</p>
            <Button size="small" type="button" disabled={pending} onPress={() => void resource.safeExecute()}>Retry</Button>
        </div>}
    </Surface>
}

function providerStatus(resource: PromiseWithDependencies<LLMProviderState>, models: string) {

    if (resource.isPending) return "Loading state…"

    if (resource.exception) return "State unavailable"

    if (!resource.solve.active) return "Inactive"

    return `Active · ${models}`
}

function message(value: unknown) {

    return value instanceof Error ? value.message : String(value)
}
