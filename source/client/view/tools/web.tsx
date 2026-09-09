import { action, input, text } from "./contract"
import ToolLayout, { type ToolViewProperties } from "./tool"

export default function WebView({ tool, snapshot }: ToolViewProperties) {

    const request = input(snapshot)
    const operation = action(snapshot, "web")
    const target = text(request?.query) || text(request?.url)

    return <ToolLayout tool={tool} snapshot={snapshot} icon="🌐" detail={target ? `${operation} · ${target}` : operation} />
}
