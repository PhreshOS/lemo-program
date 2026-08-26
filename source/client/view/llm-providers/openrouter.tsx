import type LLMModel from "@client/core/llm/model"
import type OpenRouterProvider from "@client/core/llm/providers/openrouter/provider"
import { default as OpenRouterProviderClass } from "@client/core/llm/providers/openrouter/provider"
import type { LLMProviderState } from "@server/core/llm/provider"
import usePromise, { type PromiseWithDependencies } from "@libs/react-promise"
import { useState, type FormEvent } from "react"
import type { LLMProviderViewProperties } from "../llm-providers"
import useProviderRevision from "../use-provider-revision"

export const identity = "openrouter"

export default function OpenRouterConfiguration({ providers, models }: LLMProviderViewProperties) {

    const candidate = providers.get(identity)

    if (!(candidate instanceof OpenRouterProviderClass)) throw new Error("OpenRouter Client Core is unavailable")

    const provider: OpenRouterProvider = candidate
    const [apiKey, setApiKey] = useState("")
    const revision = useProviderRevision(providers)
    const resource = usePromise(() => provider.state(), [provider, revision])
    const mutation = usePromise(async function (request: Mutation) {

        if (request.action === "configure") await provider.configure({ apiKey: request.apiKey })
        if (request.action === "activate") await provider.activate()
        if (request.action === "deactivate") await provider.deactivate()
        if (request.action === "remove") await provider.removeConfiguration()

        return true
    })
    const configuration = resource.solve
    const failure = mutation.exception?.current ?? resource.exception?.current
    const pending = mutation.isPending || resource.isPending

    async function configure(event: FormEvent) {

        event.preventDefault()

        const value = apiKey.trim()

        if (!value || pending) return

        const result = await mutation.safeExecute({ action: "configure", apiKey: value })

        if (result) setApiKey("")
    }

    return <section className="provider-settings">
        <header>
            <div>
                <h2>{provider.name}</h2>
                <p>{providerStatus(resource, providerModelCount(models, provider.identity))}</p>
            </div>

            {configuration?.configured && <div className="actions">
                {configuration.active
                    ? <button
                        type="button"
                        disabled={pending}
                        onClick={() => void mutation.safeExecute({ action: "deactivate" })}
                    >Deactivate</button>
                    : <button
                        type="button"
                        disabled={pending}
                        onClick={() => void mutation.safeExecute({ action: "activate" })}
                    >Activate</button>}
                <button
                    type="button"
                    disabled={pending}
                    onClick={() => void mutation.safeExecute({ action: "remove" })}
                >Remove</button>
            </div>}
        </header>

        <form onSubmit={configure}>
            <label htmlFor="openrouter-api-key">API key</label>
            <div className="configuration-row">
                <input
                    id="openrouter-api-key"
                    type="password"
                    value={apiKey}
                    placeholder={configuration?.configured ? "••••••••••••••••" : "Paste your API key"}
                    disabled={pending}
                    autoComplete="off"
                    onChange={event => setApiKey(event.target.value)}
                />
                <button type="submit" disabled={pending || !apiKey.trim()}>
                    {configuration?.configured ? "Replace" : "Configure"}
                </button>
            </div>
        </form>

        {pending && <p className="operation-state" role="status">Updating LLM Provider…</p>}

        {failure !== undefined && <div className="resource-error" role="alert">
            <p>{message(failure)}</p>
            <button type="button" disabled={pending} onClick={() => void resource.safeExecute()}>Retry</button>
        </div>}
    </section>
}

function providerStatus(resource: PromiseWithDependencies<LLMProviderState>, models: number) {

    if (resource.isPending) return "Loading configuration…"

    const configuration = resource.solve

    if (!configuration) return "Configuration unavailable"
    if (!configuration.configured) return "Not configured"
    if (!configuration.active) return "Inactive"

    return `Active · ${models} Models`
}

function message(value: unknown) {

    return value instanceof Error ? value.message : String(value)
}

type Mutation = Readonly<{
    action: "configure"
    apiKey: string
}> | Readonly<{
    action: "activate" | "deactivate" | "remove"
}>

function providerModelCount(resource: PromiseWithDependencies<readonly LLMModel[]>, provider: string) {

    return resource.solve?.filter(model => model.provider.identity === provider).length ?? 0
}
