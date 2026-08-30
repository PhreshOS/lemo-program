import PromptInteraction from "./prompt/interaction"
import ToolLayout, { type ToolViewProperties } from "./tool"

export default function PromptView({ tool, snapshot }: ToolViewProperties) {

    return <ToolLayout tool={tool} snapshot={snapshot} icon="💬" detail="User interaction">
        {snapshot.status === "waiting" && <PromptInteraction tool={tool} snapshot={snapshot} />}
    </ToolLayout>
}
