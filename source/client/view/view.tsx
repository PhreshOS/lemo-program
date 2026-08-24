import Application from "@client/core/application"
import { useEffect, useState } from "react"
import OllamaCloudConfiguration from "./llm-providers/ollama-cloud"
import type OllamaCloudModel from "@client/core/llm/providers/ollama-cloud/model"
import Tasks from "./tasks"
import "./style.css"

export default function View() {

    const [application] = useState(() => new Application())

    const [name, setName] = useState("")
    const [models, setModels] = useState<readonly OllamaCloudModel[]>([])
    const [settings, setSettings] = useState(false)

    useEffect(function () {

        let active = true

        void application.name().then(value => {

            if (active) setName(value)
        })

        return () => {

            active = false
        }

    }, [application])

    return <main className="shell">
        <div className="application">
            <header className="application-bar">
                <div className="identity">
                    <span className="identity-mark">L</span>
                    <div>
                        <h1>{name || "Lemo"}</h1>
                        <p>{models.length ? `${models.length} LLM Models available` : "LLM Provider required"}</p>
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

            <Tasks application={application} models={models} />

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

                    <OllamaCloudConfiguration
                        provider={application.llmProviders.ollamaCloud}
                        onModelsChange={setModels}
                    />
                </aside>
            </div>
        </div>
    </main>
}
