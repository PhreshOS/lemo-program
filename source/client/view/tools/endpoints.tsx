import { action, input, text } from "./contract"
import ToolLayout, { type ToolViewProperties } from "./tool"

export default function EndpointsView({ tool, snapshot }: ToolViewProperties) {

    const request = input(snapshot)
    const endpoint = text(request?.endpoint)
    const process = text(request?.process)
    const target = [process, endpoint].filter(Boolean).join(" · ")
    const operation = action(snapshot, "endpoint")

    return <ToolLayout tool={tool} snapshot={snapshot} icon="🔌" detail={target ? `${operation} · ${target}` : operation} />
}
