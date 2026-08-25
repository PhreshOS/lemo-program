import Application from "@client/core/application"
import type LLMModel from "@client/core/llm/model"
import usePromise, { type PromiseWithDependencies } from "@libs/react-promise"
import { CurrentProvider, useProcess, useProgram } from "@phreshos/react"
import { useEffect, useState } from "react"
import promptSource from "./prompt-source"
import { StartupState } from "./state"
import Tasks from "./tasks"

export default function AgentRoute() {

    return <CurrentProvider
        provide={["program", "process"]}
        waitServer
        fallback={<StartupState title="Starting Lemo Agent…" />}
    >
        <Agent />
    </CurrentProvider>
}

function Agent() {

    const program = useProgram()
    const process = useProcess()
    const [application] = useState(() => new Application(process.server, promptSource))
    const models = usePromise(() => application.llmProviders.models(), [application])

    useEffect(function () {

        application.start()

        return () => application.stop()

    }, [application])

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
            </header>

            <Tasks application={application} models={models} />
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
