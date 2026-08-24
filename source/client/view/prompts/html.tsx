import type { PromptRequest, PromptValue } from "@client/core/prompts/contract"
import type Prompt from "@client/core/prompts/prompt"
import { useEffect, useMemo, useRef, useState } from "react"
import htmlPromptDocument from "./html-document"

type HtmlRequest = Extract<PromptRequest, { type: "html" }>

export default function HtmlPrompt({ prompt, request, report }: Readonly<{
    prompt: Prompt
    request: HtmlRequest
    report(error: string): void
}>) {

    const frame = useRef<HTMLIFrameElement>(null)
    const [channel] = useState(() => crypto.randomUUID())
    const source = useMemo(() => htmlPromptDocument(request.html, channel), [request.html, channel])

    function fail(error: unknown) {

        try {
            prompt.fail(error)
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
                    prompt.submit(value.values as Record<string, PromptValue>)
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

    }, [channel, prompt, report])

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
