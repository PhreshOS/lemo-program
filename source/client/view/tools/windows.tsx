import { action, input, text } from "./contract"
import ToolLayout, { type ToolViewProperties } from "./tool"

export default function WindowsView({ tool, snapshot }: ToolViewProperties) {

    const request = input(snapshot)
    const process = text(request?.process)
    const operation = action(snapshot, "window")

    return <ToolLayout tool={tool} snapshot={snapshot} icon="🪟" detail={process ? `${operation} · ${process}` : operation} />
}
