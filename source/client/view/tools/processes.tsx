import { action, input, text } from "./contract"
import ToolLayout, { type ToolViewProperties } from "./tool"

export default function ProcessesView({ tool, snapshot }: ToolViewProperties) {

    const request = input(snapshot)
    const target = text(request?.process) || text(request?.program)
    const operation = action(snapshot, "processes")

    return <ToolLayout tool={tool} snapshot={snapshot} icon="⚙" detail={target ? `${operation} · ${target}` : operation} />
}
