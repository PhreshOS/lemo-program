import type Tool from "@client/core/lemo/tool"
import type { ToolSnapshot, ToolStatus } from "@client/core/lemo/tool"
import type { ReactNode } from "react"
import ApprovalView from "./approval"

export type ToolViewProperties = Readonly<{ tool: Tool, snapshot: ToolSnapshot }>

/** Shared lifecycle presentation composed by dedicated Tool views. */
export default function ToolLayout({ tool, snapshot, icon, detail, children }: ToolViewProperties & Readonly<{
    icon: string
    detail?: string
    children?: ReactNode
}>) {

    return <div className="runtime-message">
        <div className="tool-event" data-status={snapshot.status}>
            <div className="tool-event-header">
                <span className="tool-icon">{icon}</span>
                <code className="tool-name">{tool.name}</code>
                {detail && <small className="tool-detail">{detail}</small>}
                <span className={`tool-status-pill status-${snapshot.status}`}>
                    {status(snapshot.status)}
                </span>
            </div>
            {snapshot.error && <div className="tool-error"><small>{snapshot.error}</small></div>}
        </div>

        {children}
        {snapshot.approval && <ApprovalView tool={tool} snapshot={snapshot} />}
    </div>
}

function status(value: ToolStatus) {

    if (value === "running") return "Running"

    if (value === "waiting") return "Waiting"

    if (value === "failed") return "Failed"

    return "Completed"
}
