import type OllamaCloudProvider from "@client/core/llm/providers/ollama-cloud/provider"
import type OllamaCloudModel from "@client/core/llm/providers/ollama-cloud/model"
import { useEffect, useState, type FormEvent } from "react"

export default function OllamaCloudConfiguration({ provider }: Properties) {

    const [configured, setConfigured] = useState<boolean>()

    const [isActive, setActive] = useState<boolean>()

    const [models, setModels] = useState<readonly OllamaCloudModel[]>([])

    const [apiKey, setApiKey] = useState("")

    const [pending, setPending] = useState(false)

    const [error, setError] = useState("")

    useEffect(function () {

        let active = true

        void (async function () {

            try {

                const state = await provider.state()

                if (!active) return

                setConfigured(state.configured)

                setActive(state.active)

                if (!state.configured || !state.active) return

                const discovered = await provider.models()

                if (!active) return

                setModels(discovered)
            } catch (failure) {

                if (active) setError(message(failure))
            }
        })()

        return () => {

            active = false
        }

    }, [provider])

    async function configure(event: FormEvent) {

        event.preventDefault()

        const value = apiKey.trim()

        if (!value || pending) return

        setPending(true)

        setError("")

        try {

            await provider.configure({ apiKey: value })

            const state = await provider.state()

            setApiKey("")

            setConfigured(state.configured)

            setActive(state.active)

            const discovered = state.active ? await provider.models() : []

            setModels(discovered)
        } catch (failure) {

            setError(message(failure))
        } finally {

            setPending(false)
        }
    }

    async function activate() {

        if (pending) return

        setPending(true)

        setError("")

        try {

            await provider.activate()

            setActive(true)

            const discovered = configured ? await provider.models() : []

            setModels(discovered)
        } catch (failure) {

            setError(message(failure))
        } finally {

            setPending(false)
        }
    }

    async function deactivate() {

        if (pending) return

        setPending(true)

        setError("")

        try {

            await provider.deactivate()

            setActive(false)

            setModels([])
        } catch (failure) {

            setError(message(failure))
        } finally {

            setPending(false)
        }
    }

    async function remove() {

        if (pending) return

        setPending(true)

        setError("")

        try {

            await provider.removeConfiguration()

            setConfigured(false)

            setModels([])
        } catch (failure) {

            setError(message(failure))
        } finally {

            setPending(false)
        }
    }

    return <section>
        <header>
            <div>
                <h2>{provider.name}</h2>
                <p>{configured === undefined ? "Loading configuration…" : configured ? "Configured" : "Not configured"}</p>
            </div>

            {configured && <div className="actions">
                {isActive
                    ? <button type="button" disabled={pending} onClick={deactivate}>Deactivate</button>
                    : <button type="button" disabled={pending} onClick={activate}>Activate</button>}
                <button type="button" disabled={pending} onClick={remove}>Remove</button>
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
                    {configured ? "Replace" : "Configure"}
                </button>
            </div>
        </form>

        {configured && isActive && <div>
            <h3>LLM Models</h3>
            {models.length
                ? <ul>{models.map(model => <li key={model.id}>{model.id}</li>)}</ul>
                : <p>No Models are available.</p>}
        </div>}

        {error && <p role="alert">{error}</p>}
    </section>
}

function message(value: unknown) {

    return value instanceof Error ? value.message : String(value)
}

type Properties = Readonly<{
    provider: OllamaCloudProvider
}>
