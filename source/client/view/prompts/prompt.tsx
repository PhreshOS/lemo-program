import type Prompt from "@client/core/prompts/prompt"
import { useState } from "react"
import ApprovalPrompt from "./approval"
import FormPrompt from "./form"
import HtmlPrompt from "./html"

export default function PromptView({ prompt }: Readonly<{ prompt: Prompt }>) {

    if (prompt.request.type === "approval") return <ApprovalPrompt prompt={prompt} />

    return <InteractivePrompt prompt={prompt} />
}

function InteractivePrompt({ prompt }: Readonly<{ prompt: Prompt }>) {

    const [error, setError] = useState("")

    function cancel() {

        setError("")

        try {
            prompt.cancel()
        } catch (cause) {
            setError(message(cause))
        }
    }

    return <section className="client-prompt" aria-label="Lemo needs your response">
        <header>
            <div>
                <strong>{prompt.request.title ?? "Lemo needs your response"}</strong>
                <span>{prompt.isResponding ? "Sending…" : "Waiting"}</span>
            </div>

            <button
                className="quiet danger"
                type="button"
                disabled={prompt.isResponding}
                onClick={cancel}
            >Cancel</button>
        </header>

        {prompt.request.type === "form"
            ? <FormPrompt prompt={prompt} request={prompt.request} report={setError} />
            : prompt.request.type === "html"
                ? <HtmlPrompt prompt={prompt} request={prompt.request} report={setError} />
                : null}

        {(error || prompt.validationError) && <small role="alert">{error || prompt.validationError}</small>}
    </section>
}

function message(value: unknown) {

    return value instanceof Error ? value.message : String(value)
}
