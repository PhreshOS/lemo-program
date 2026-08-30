import type { PromptRequest, PromptValue } from "@server/core/lemo/runtime/tools/prompt/contract"
import type Tool from "@client/core/lemo/tool"
import { useEffect, useMemo, useRef, useState } from "react"
import promptHtmlDocument from "./html-document"

type HtmlRequest = Extract<PromptRequest, { type: "html" }>

export default function PromptHtml({ tool, request, report }: Readonly<{
    tool: Tool
    request: HtmlRequest
    report(error: string): void
}>) {

    const frame = useRef<HTMLIFrameElement>(null)
    const [channel] = useState(() => crypto.randomUUID())
    const source = useMemo(() => promptHtmlDocument(request.html, channel), [request.html, channel])

    function fail(error: unknown) {

        try {
            const content = error instanceof Error ? error.message : String(error)

            void tool.respond({
                type: "failed",
                error: (content || "The interactive document failed").slice(0, 1_000)
            }).catch(cause => report(cause instanceof Error ? cause.message : String(cause)))
        } catch (cause) {
            report(cause instanceof Error ? cause.message : String(cause))
        }
    }

    useEffect(function () {

        function receive(event: MessageEvent<unknown>) {

            if (event.source !== frame.current?.contentWindow) return

            const value = record(event.data)

            if (value?.scope !== "lemo.html-prompt" || value.channel !== channel) return

            report("")

            try {
                if (value.type === "submit" && record(value.values)) {
                    void tool.respond({
                        type: "submitted",
                        values: value.values as Record<string, PromptValue>
                    }).catch(cause => report(
                        cause instanceof Error ? cause.message : String(cause)
                    ))
                    return
                }

                if (value.type === "failure" && typeof value.error === "string") {
                    fail(value.error)
                    return
                }

                fail("The interactive document sent an invalid message")
            } catch (cause) {
                report(cause instanceof Error ? cause.message : String(cause))
            }
        }

        window.addEventListener("message", receive)

        return () => window.removeEventListener("message", receive)

    }, [channel, tool, report])

    return <div className="html-prompt">
        <iframe
            ref={frame}
            title={request.title ?? "Interactive prompt"}
            srcDoc={source}
            sandbox="allow-scripts allow-forms"
            onError={() => fail("The interactive document could not load")}
        />
    </div>
}

function record(value: unknown) {

    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null
}
