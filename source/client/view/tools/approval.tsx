import { Button, Surface } from "@phreshos/react-ui"
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

    return <Surface className="client-prompt prompt-approval" aria-label={approval.request.title}>
        <div className="prompt-heading">
            <div>
                <strong>{approval.request.title}</strong>
                <span>{snapshot.isResponding ? "Sending…" : "Approval required"}</span>
            </div>
        </div>

        <p>{approval.request.content}</p>

        <div className="prompt-approval-actions">
            <Button size="small"
                color="danger:base"
                type="button"
                disabled={snapshot.isResponding}
                onPress={() => respond("deny")}
            >Reject</Button>
            <Button size="small"
                type="button"
                disabled={snapshot.isResponding}
                onPress={() => respond("approve")}
            >Approve</Button>
        </div>

        {(error || snapshot.validationError) && <small role="alert">{error || snapshot.validationError}</small>}
    </Surface>
}
