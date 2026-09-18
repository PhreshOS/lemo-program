import { input, text } from "./contract"
import ToolLayout, { type ToolViewProperties } from "./tool"

export default function SystemView({ tool, snapshot }: ToolViewProperties) {

    const request = input(snapshot)
    const domain = text(request?.$domain)
    const operation = text(request?.$operation)
    const detail = [domain, operation].filter(Boolean).join(".") || "System"

    return <ToolLayout tool={tool} snapshot={snapshot} icon="⚡" detail={detail} />
}
