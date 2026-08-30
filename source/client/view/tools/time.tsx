import ToolLayout, { type ToolViewProperties } from "./tool"

export default function TimeView({ tool, snapshot }: ToolViewProperties) {

    const output = snapshot.output as { iso?: unknown } | null
    const time = typeof output?.iso === "string" ? output.iso : "Current server time"

    return <ToolLayout tool={tool} snapshot={snapshot} icon="⏱" detail={time} />
}
