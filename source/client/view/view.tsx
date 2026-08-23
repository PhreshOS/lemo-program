import Application from "@client/core/application"
import { useEffect, useState } from "react"
import OllamaCloudConfiguration from "./llm-providers/ollama-cloud"
import "./style.css"

export default function View() {

    const [application] = useState(() => new Application())

    const [name, setName] = useState("")

    useEffect(function () {

        let active = true

        void application.name().then(value => {

            if (active) setName(value)
        })

        return () => {

            active = false
        }

    }, [application])

    return <main>
        <div className="application">
            <header>
                <p>PhreshOS Agent</p>
                <h1>{name || "…"}</h1>
            </header>

            <OllamaCloudConfiguration provider={application.llmProviders.ollamaCloud} />
        </div>
    </main>
}
