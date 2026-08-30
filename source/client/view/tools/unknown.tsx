import ToolLayout, { type ToolViewProperties } from "./tool"

export default function UnknownView({ tool, snapshot }: ToolViewProperties) {

    return <ToolLayout tool={tool} snapshot={snapshot} icon="🔧" detail="Unknown Tool contract" />
}
