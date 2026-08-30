import { action, input, text } from "./contract"
import ToolLayout, { type ToolViewProperties } from "./tool"

export default function ShellView({ tool, snapshot }: ToolViewProperties) {

    const request = input(snapshot)
    const operation = action(snapshot, "shell")
    const command = text(request?.command)

    return <ToolLayout tool={tool} snapshot={snapshot} icon="⌨" detail={command || operation} />
}
