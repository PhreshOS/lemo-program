import { input, text } from "./contract"
import ToolLayout, { type ToolViewProperties } from "./tool"

export default function MemoryView({ tool, snapshot }: ToolViewProperties) {

    return <ToolLayout tool={tool} snapshot={snapshot} icon="🧠" detail={text(input(snapshot)?.query) || "Recall memory"} />
}
