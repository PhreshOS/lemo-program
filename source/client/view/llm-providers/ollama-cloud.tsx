import type OllamaCloudProvider from "@client/core/llm/providers/ollama-cloud/provider"
import usePromise, { type PromiseWithDependencies } from "@libs/react-promise"
import { useState, type FormEvent } from "react"
import {
    OllamaCloudLoadingError,
    type OllamaCloudSnapshot
} from "./ollama-cloud-resource"

export default function OllamaCloudConfiguration({ provider, resource }: Properties) {

    const [apiKey, setApiKey] = useState("")

    const mutation = usePromise(async function (request: Mutation) {

        if (request.action === "configure") await provider.configure({ apiKey: request.apiKey })

        if (request.action === "activate") await provider.activate()

        if (request.action === "deactivate") await provider.deactivate()

        if (request.action === "remove") await provider.removeConfiguration()

        return resource.execute()
    })

    const snapshot = resource.solve

    const configuration = snapshot?.configuration
        ?? loadingError(resource.exception?.current)?.configuration

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
                <p>{providerStatus(resource)}</p>
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
            <label htmlFor="ollama-cloud-api-key">API key</label>
            <div className="configuration-row">
                <input
                    id="ollama-cloud-api-key"
                    type="password"
                    value={apiKey}
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

function providerStatus(resource: PromiseWithDependencies<OllamaCloudSnapshot>) {

    if (resource.isPending) return "Loading configuration…"

    const configuration = resource.solve?.configuration
        ?? loadingError(resource.exception?.current)?.configuration

    if (!configuration) return "Configuration unavailable"

    if (!configuration.configured) return "Not configured"

    if (!configuration.active) return "Inactive"

    if (resource.exception) return "Active · Model loading failed"

    return `Active · ${resource.solve?.models.length ?? 0} Models`
}

function loadingError(value: unknown) {

    return value instanceof OllamaCloudLoadingError ? value : null
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

type Properties = Readonly<{
    provider: OllamaCloudProvider
    resource: PromiseWithDependencies<OllamaCloudSnapshot>
}>
