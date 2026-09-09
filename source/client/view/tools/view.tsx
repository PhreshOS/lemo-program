import type Tool from "@client/core/lemo/tool"
import { useCallback, useSyncExternalStore, type ComponentType } from "react"
import DocsView from "./docs"
import EndpointsView from "./endpoints"
import FilesView from "./files"
import type { ToolViewProperties } from "./tool"
import MemoryView from "./memory"
import ProcessesView from "./processes"
import ProgramsView from "./programs"
import PromptView from "./prompt"
import ShellView from "./shell"
import TasksView from "./tasks"
import TimeView from "./time"
import ToolsView from "./tools"
import UnknownView from "./unknown"
import WebView from "./web"
import WindowsView from "./windows"

const views: Readonly<Record<string, ComponentType<ToolViewProperties>>> = Object.freeze({
    docs: DocsView,
    endpoints: EndpointsView,
    files: FilesView,
    memory: MemoryView,
    processes: ProcessesView,
    programs: ProgramsView,
    prompt: PromptView,
    shell: ShellView,
    tasks: TasksView,
    time: TimeView,
    tools: ToolsView,
    web: WebView,
    windows: WindowsView
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
