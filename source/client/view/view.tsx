import Application from "@client/core/application"
import type LLMModel from "@client/core/llm/model"
import usePromise, { type PromiseWithDependencies } from "@libs/react-promise"
import { CurrentProvider, useProgram } from "@phreshos/react"
import { Component, useEffect, useRef, useState, type ReactNode } from "react"
import LLMProviderViews from "./llm-providers"
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

    const settingsDialog = useRef<HTMLDialogElement>(null)

    const models = usePromise(() => application.llmProviders.models(), [application])

    useEffect(function () {

        application.start()

        return () => application.stop()

    }, [application])

    useEffect(function () {

        const dialog = settingsDialog.current

        if (!dialog) return

        if (settings && !dialog.open) dialog.showModal()

        if (!settings && dialog.open) dialog.close()

    }, [settings])

    return <main className="shell">
        <div className="application">
            <header className="application-bar">
                <div className="identity">
                    <span className="identity-mark" title="Lemo AI Agent">L</span>
                    <div className="identity-text">
                        <div className="identity-title-row">
                            <h1>{program.name}</h1>
                            <span className={`status-pill ${statusKind(models)}`}>
                                <i className="status-dot" />
                                <span>{modelStatus(models)}</span>
                            </span>
                        </div>
                        <p className="identity-sub">PhreshOS Autonomous Agent</p>
                    </div>
                </div>

                <div className="application-actions">
                    <button
                        className={`quiet settings-toggle${settings ? " active" : ""}`}
                        type="button"
                        aria-controls="lemo-settings"
                        aria-expanded={settings}
                        onClick={() => setSettings(value => !value)}
                    >
                        <span className="icon-gear">⚙</span>
                        <span>{settings ? "Close" : "Settings"}</span>
                    </button>
                </div>
            </header>

            <Tasks application={application} models={models} />

            <dialog
                ref={settingsDialog}
                id="lemo-settings"
                className="settings-layer"
                aria-labelledby="lemo-settings-title"
                onClose={() => setSettings(false)}
                onMouseDown={event => {

                    if (event.target === event.currentTarget) setSettings(false)
                }}
            >
                <aside className="settings" aria-label="Lemo Settings" onMouseDown={event => event.stopPropagation()}>
                    <header>
                        <div>
                            <p>Configuration</p>
                            <h2 id="lemo-settings-title">LLM Providers</h2>
                        </div>

                        <button autoFocus className="quiet close-settings" type="button" onClick={() => setSettings(false)}>Done</button>
                    </header>

                    <LLMProviderViews providers={application.llmProviders} models={models} />
                </aside>
            </dialog>
        </div>
    </main>
}

function statusKind(resource: PromiseWithDependencies<readonly LLMModel[]>): "ready" | "pending" | "error" | "warning" {

    if (resource.isPending) return "pending"

    if (resource.exception) return "error"

    if (!resource.solve.length) return "warning"

    return "ready"
}

function modelStatus(resource: PromiseWithDependencies<readonly LLMModel[]>) {

    if (resource.isPending) return "Connecting…"

    if (resource.exception) return "Unavailable"

    if (!resource.solve.length) return "Setup Required"

    return `${resource.solve.length} Model${resource.solve.length === 1 ? "" : "s"}`
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
