import { Button, Surface } from "@phreshos/react-ui"
import type Tool from "@client/core/lemo/tool"
import type { ToolSnapshot } from "@client/core/lemo/tool"
import { interactivePromptRequestSchema } from "@server/core/lemo/runtime/tools/prompt/contract"
import { useState } from "react"
import PromptForm from "./form"
import PromptHtml from "./html"

export default function PromptInteraction({ tool, snapshot }: Readonly<{
    tool: Tool
    snapshot: ToolSnapshot
}>) {

    const request = interactivePromptRequestSchema.safeParse(snapshot.input)

    return request.success ? <InteractivePrompt tool={tool} snapshot={snapshot} request={request.data} /> : null
}

function InteractivePrompt({ tool, snapshot, request }: Readonly<{
    tool: Tool
    snapshot: ToolSnapshot
    request: ReturnType<typeof interactivePromptRequestSchema.parse>
}>) {

    const [error, setError] = useState("")

    function cancel() {

        setError("")

        try {
            void tool.respond({ type: "cancelled" }).catch(cause => setError(message(cause)))
        } catch (cause) {
            setError(message(cause))
        }
    }

    return <Surface className="client-prompt" aria-label="Lemo needs your response">
        <div className="prompt-heading">
            <div>
                <strong>{request.title ?? "Lemo needs your response"}</strong>
                <span>{snapshot.isResponding ? "Sending…" : "Waiting"}</span>
            </div>

            <Button size="small"
                color="danger:base"
                type="button"
                disabled={snapshot.isResponding}
                onPress={cancel}
            >Cancel</Button>
        </div>

        {request.type === "form"
            ? <PromptForm tool={tool} snapshot={snapshot} request={request} report={setError} />
            : request.type === "html"
                ? <PromptHtml tool={tool} request={request} report={setError} />
                : null}

        {(error || snapshot.validationError) && <small role="alert">{error || snapshot.validationError}</small>}
    </Surface>
}

function message(value: unknown) {

    return value instanceof Error ? value.message : String(value)
}
