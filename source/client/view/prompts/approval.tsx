import type Prompt from "@client/core/prompts/prompt"
import { useState } from "react"

export default function ApprovalPrompt({ prompt }: Readonly<{ prompt: Prompt }>) {

    const [error, setError] = useState("")

    function respond(action: "approve" | "deny") {

        setError("")

        try {
            prompt[action]()
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause))
        }
    }

    if (prompt.request.type !== "approval") return null

    return <section className="client-prompt prompt-approval" aria-label={prompt.request.title}>
        <header>
            <div>
                <strong>{prompt.request.title}</strong>
                <span>{prompt.isResponding ? "Sending…" : "Approval required"}</span>
            </div>
        </header>

        <p>{prompt.request.content}</p>

        <div className="prompt-approval-actions">
            <button
                className="quiet danger"
                type="button"
                disabled={prompt.isResponding}
                onClick={() => respond("deny")}
            >Reject</button>
            <button
                type="button"
                disabled={prompt.isResponding}
                onClick={() => respond("approve")}
            >Approve</button>
        </div>

        {(error || prompt.validationError) && <small role="alert">{error || prompt.validationError}</small>}
    </section>
}
