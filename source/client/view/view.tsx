import Application from "@client/core/application"
import usePromise, { type PromiseWithDependencies } from "@libs/react-promise"
import { CurrentProvider, useProgram } from "@phreshos/react"
import { Component, useEffect, useState, type ReactNode } from "react"
import OllamaCloudConfiguration from "./llm-providers/ollama-cloud"
import {
    loadOllamaCloud,
    type OllamaCloudSnapshot
} from "./llm-providers/ollama-cloud-resource"
import promptSource from "./prompt-source"
import Tasks from "./tasks"
import "./style.css"

export default function View() {

    const [attempt, setAttempt] = useState(0)

    return <ApplicationBoundary key={attempt} retry={() => setAttempt(value => value + 1)}>
        <CurrentProvider
            provide={["program"]}
            waitServer
            fallback={<StartupState title="Starting Lemo…" />}
        >
            <ApplicationView />
        </CurrentProvider>
    </ApplicationBoundary>
}

function ApplicationView() {

    const program = useProgram()

    const [application] = useState(() => new Application(promptSource))

    const [settings, setSettings] = useState(false)

    const provider = application.llmProviders.ollamaCloud

    const ollamaCloud = usePromise(() => loadOllamaCloud(provider), [provider])

    useEffect(function () {

        application.start()

        return () => application.stop()

    }, [application])

    return <main className="shell">
        <div className="application">
            <header className="application-bar">
                <div className="identity">
                    <span className="identity-mark">L</span>
                    <div>
                        <h1>{program.name}</h1>
                        <p>{modelStatus(ollamaCloud)}</p>
                    </div>
                </div>

                <button
                    className="quiet"
                    type="button"
                    aria-expanded={settings}
                    onClick={() => setSettings(value => !value)}
                >
                    {settings ? "Close" : "Settings"}
                </button>
            </header>

            <Tasks application={application} models={ollamaCloud} />

            <div
                className={`settings-layer${settings ? " open" : ""}`}
                aria-hidden={!settings}
                inert={!settings}
                onMouseDown={() => setSettings(false)}
            >
                <aside className="settings" aria-label="Lemo Settings" onMouseDown={event => event.stopPropagation()}>
                    <header>
                        <div>
                            <p>Configuration</p>
                            <h2>LLM Providers</h2>
                        </div>

                        <button className="quiet" type="button" onClick={() => setSettings(false)}>Done</button>
                    </header>

                    <OllamaCloudConfiguration provider={provider} resource={ollamaCloud} />
                </aside>
            </div>
        </div>
    </main>
}

function modelStatus(resource: PromiseWithDependencies<OllamaCloudSnapshot>) {

    if (resource.isPending) return "Loading LLM Provider…"

    if (resource.exception) return "LLM Models unavailable"

    if (!resource.solve.models.length) return "LLM Provider required"

    return `${resource.solve.models.length} LLM Models available`
}

function StartupState({ title, error, retry }: Readonly<{
    title: string
    error?: unknown
    retry?: () => void
}>) {

    return <main className="shell startup-state">
        <span className="identity-mark">L</span>
        <strong>{title}</strong>
        {error !== undefined && <p role="alert">{message(error)}</p>}
        {retry && <button className="quiet" type="button" onClick={retry}>Retry</button>}
    </main>
}

class ApplicationBoundary extends Component<BoundaryProperties, BoundaryState> {

    public state: BoundaryState = { error: null }

    public static getDerivedStateFromError(error: unknown): BoundaryState {

        return { error }
    }

    public render() {

        if (this.state.error !== null) {

            return <StartupState title="Lemo could not start" error={this.state.error} retry={this.props.retry} />
        }

        return this.props.children
    }
}

function message(value: unknown) {

    return value instanceof Error ? value.message : String(value)
}

type BoundaryProperties = Readonly<{
    children: ReactNode
    retry(): void
}>

type BoundaryState = Readonly<{
    error: unknown | null
}>
