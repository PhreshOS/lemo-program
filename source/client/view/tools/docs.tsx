import { input, text } from "./contract"
import ToolLayout, { type ToolViewProperties } from "./tool"

export default function DocsView({ tool, snapshot }: ToolViewProperties) {

    const name = text(input(snapshot)?.name)

    return <ToolLayout tool={tool} snapshot={snapshot} icon="📖" detail={name ? `Documentation for ${name}` : "Documentation"} />
}
