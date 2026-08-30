import { action, input, text } from "./contract"
import ToolLayout, { type ToolViewProperties } from "./tool"

export default function TasksView({ tool, snapshot }: ToolViewProperties) {

    const request = input(snapshot)
    const target = text(request?.task) || text(request?.event)
    const operation = action(snapshot, "tasks")

    return <ToolLayout tool={tool} snapshot={snapshot} icon="✓" detail={target ? `${operation} · ${target}` : operation} />
}
