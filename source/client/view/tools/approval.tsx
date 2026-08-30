import type Tool from "@client/core/lemo/tool"
import type { ToolSnapshot } from "@client/core/lemo/tool"
import { useState } from "react"

/** Shared approval interaction used by Tool views. */
export default function ApprovalView({ tool, snapshot }: Readonly<{
    tool: Tool
    snapshot: ToolSnapshot
}>) {

    const [error, setError] = useState("")

    function respond(action: "approve" | "deny") {

        setError("")

        try {
            void tool[action]().catch(cause => setError(cause instanceof Error ? cause.message : String(cause)))
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause))
        }
    }

    const approval = snapshot.approval

    if (!approval) return null

    return <section className="client-prompt prompt-approval" aria-label={approval.request.title}>
        <header>
            <div>
                <strong>{approval.request.title}</strong>
                <span>{snapshot.isResponding ? "Sending…" : "Approval required"}</span>
            </div>
        </header>

        <p>{approval.request.content}</p>

        <div className="prompt-approval-actions">
            <button
                className="quiet danger"
                type="button"
                disabled={snapshot.isResponding}
                onClick={() => respond("deny")}
            >Reject</button>
            <button
                type="button"
                disabled={snapshot.isResponding}
                onClick={() => respond("approve")}
            >Approve</button>
        </div>

        {(error || snapshot.validationError) && <small role="alert">{error || snapshot.validationError}</small>}
    </section>
}
