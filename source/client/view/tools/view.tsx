import type Tool from "@client/core/lemo/tool"
import { useCallback, useSyncExternalStore, type ComponentType } from "react"
import DocsView from "./docs"
import FilesView from "./files"
import type { ToolViewProperties } from "./tool"
import MemoryView from "./memory"
import PromptView from "./prompt"
import ShellView from "./shell"
import SystemView from "./system"
import TasksView from "./tasks"
import TimeView from "./time"
import ToolsView from "./tools"
import UnknownView from "./unknown"
import WebView from "./web"

const views: Readonly<Record<string, ComponentType<ToolViewProperties>>> = Object.freeze({
    docs: DocsView,
    files: FilesView,
    memory: MemoryView,
    prompt: PromptView,
    shell: ShellView,
    system: SystemView,
    tasks: TasksView,
    time: TimeView,
    tools: ToolsView,
    web: WebView
})

/** Selects the dedicated Client view for one Tool contract. */
export default function ToolView({ tool }: Readonly<{ tool: Tool }>) {

    const snapshot = useTool(tool)

    const View = views[tool.name] ?? UnknownView

    return <View tool={tool} snapshot={snapshot} />
}

function useTool(tool: Tool) {

    const subscribe = useCallback((listener: () => void) => tool.subscribe(listener), [tool])
    const snapshot = useCallback(() => tool.snapshot(), [tool])

    return useSyncExternalStore(subscribe, snapshot, snapshot)
}
