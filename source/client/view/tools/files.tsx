import { action, input, text } from "./contract"
import ToolLayout, { type ToolViewProperties } from "./tool"

export default function FilesView({ tool, snapshot }: ToolViewProperties) {

    const request = input(snapshot)
    const source = text(request?.source)
    const destination = text(request?.destination)
    const path = text(request?.path)
    const target = source && destination ? `${source} → ${destination}` : path
    const operation = action(snapshot, "files")

    return <ToolLayout tool={tool} snapshot={snapshot} icon="📄" detail={target ? `${operation} · ${target}` : operation} />
}
