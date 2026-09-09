import type LLMModel from "@client/core/llm/model"
import type NvidiaProvider from "@client/core/llm/providers/nvidia/provider"
import { default as NvidiaProviderClass } from "@client/core/llm/providers/nvidia/provider"
import type { LLMProviderState } from "@server/core/llm/provider"
import usePromise, { type PromiseWithDependencies } from "@libs/react-promise"
import { useState, type FormEvent } from "react"
import type { LLMProviderViewProperties } from "../llm-providers"
import useProviderRevision from "../use-provider-revision"

export const identity = "nvidia"

export default function NvidiaConfiguration({ providers, models }: LLMProviderViewProperties) {

    const candidate = providers.get(identity)

    if (!(candidate instanceof NvidiaProviderClass)) throw new Error("NVIDIA Client Core is unavailable")

    const provider: NvidiaProvider = candidate
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

    return <div className="provider-settings">
        <div className="provider-heading">
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
        </div>

        <form onSubmit={configure}>
            <label htmlFor="nvidia-api-key">API key</label>
            <div className="configuration-row">
                <input
                    id="nvidia-api-key"
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

        <p><a href="https://build.nvidia.com/settings/api-key" target="_blank" rel="noreferrer">Get an NVIDIA API key</a></p>

        {pending && <p className="operation-state" role="status">Updating LLM Provider…</p>}

        {failure !== undefined && <div className="resource-error" role="alert">
            <p>{message(failure)}</p>
            <button type="button" disabled={pending} onClick={() => void resource.safeExecute()}>Retry</button>
        </div>}
    </div>
}

function providerStatus(resource: PromiseWithDependencies<LLMProviderState>, models: number | "pending" | "unavailable") {

    if (resource.isPending) return "Loading configuration…"

    const configuration = resource.solve

    if (!configuration) return "Configuration unavailable"
    if (!configuration.configured) return "Not configured"
    if (!configuration.active) return "Inactive"

    if (models === "pending") return "Active · Loading Models…"
    if (models === "unavailable") return "Active · Models unavailable"

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

    if (resource.isPending) return "pending"

    const models = resource.solve

    return models ? models.filter(model => model.provider.identity === provider).length : "unavailable"
}
