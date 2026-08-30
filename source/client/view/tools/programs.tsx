import { action, input, text } from "./contract"
import ToolLayout, { type ToolViewProperties } from "./tool"

export default function ProgramsView({ tool, snapshot }: ToolViewProperties) {

    const request = input(snapshot)
    const target = text(request?.program) || text(request?.search)
    const operation = action(snapshot, "programs")

    return <ToolLayout tool={tool} snapshot={snapshot} icon="⚡" detail={target ? `${operation} · ${target}` : operation} />
}
