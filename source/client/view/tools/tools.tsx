import { input } from "./contract"
import ToolLayout, { type ToolViewProperties } from "./tool"

export default function ToolsView({ tool, snapshot }: ToolViewProperties) {

    const request = input(snapshot)
    const names = Array.isArray(request?.names)
        ? request.names.filter((name): name is string => typeof name === "string")
        : []
    const detail = request?.all === true ? "Load all tools" : names.length ? `Load ${names.join(", ")}` : "Discover tools"

    return <ToolLayout tool={tool} snapshot={snapshot} icon="🧰" detail={detail} />
}
