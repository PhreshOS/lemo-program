import { Button, Input, Select, Surface, Textarea } from "@phreshos/react-ui"
import type Application from "@client/core/application"
import type Task from "@client/core/lemo/task"
import type LLMModel from "@client/core/llm/model"
import usePromise, { type PromiseWithDependencies } from "@libs/react-promise"
import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    useSyncExternalStore,
    type FormEvent,
    type KeyboardEvent
} from "react"
import Markdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import ToolView from "./tools/view"
import icon from "../../../icon.png"

const maximumVisibleModels = 100

export default function Tasks({ application, models: modelResource }: Properties) {

    const [input, setInput] = useState("")
    const [modelSearch, setModelSearch] = useState("")
    const [selectedModel, setSelectedModel] = useState("")
    const [selectedReasoning, setSelectedReasoning] = useState<string | null>(null)
    const [selectedTask, setSelectedTask] = useState("")
    const textareaRef = useRef<HTMLTextAreaElement>(null)

    const taskResource = usePromise(async function () {

        return await application.lemo.start()

    }, [application])

    const creation = usePromise((question: string, model: LLMModel) => (
        application.lemo.task({ input: question, model })
    ))

    const projectedTasks = useTasks(application.lemo)

    const tasks = taskResource.solve ? projectedTasks : []

    const activeTasks = tasks.filter(task => executing(task.status))

    const recentTasks = tasks.filter(task => !executing(task.status))

    const models = modelResource.solve ?? []

    const available = useMemo(() => new Map(models.map(model => [modelKey(model), model])), [models])

    const model = available.get(selectedModel) ?? models[0] ?? null

    const reasoningLevels = usePromise(
        () => model ? model.reasoningLevels() : Promise.resolve(null),
        [model]
    )

    const reasoningMutation = usePromise(async function (target: LLMModel, level: string | null) {

        await target.setReasoning(level)

        return true
    })

    const matchingModels = useMemo(function () {

        const query = modelSearch.trim().toLocaleLowerCase()

        if (!query) return models

        return models.filter(candidate => (
            candidate.id.toLocaleLowerCase().includes(query)
            || candidate.provider.name.toLocaleLowerCase().includes(query)
            || candidate.provider.identity.toLocaleLowerCase().includes(query)
        ))

    }, [modelSearch, models])

    const visibleModels = useMemo(function () {

        const visible = matchingModels.slice(0, maximumVisibleModels)

        if (!model || visible.includes(model)) return visible

        return [model, ...visible.slice(0, maximumVisibleModels - 1)]

    }, [matchingModels, model])

    const currentTask = tasks.find(task => task.id === selectedTask) ?? null

    useLayoutEffect(function () {

        const textarea = textareaRef.current

        if (!textarea) return

        textarea.style.height = "auto"
        textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`

    }, [input])

    useEffect(function () {

        if (model && selectedModel !== modelKey(model)) setSelectedModel(modelKey(model))

    }, [model, selectedModel])

    useEffect(function () {

        setSelectedReasoning(model?.reasoning ?? null)

    }, [model, model?.reasoning])

    useEffect(function () {

        if (!taskResource.solve) return

        setSelectedTask(current => (
            tasks.some(task => task.id === current)
                ? current
                : tasks[0]?.id ?? ""
        ))

    }, [taskResource.solve, tasks])

    function startNewTask() {

        setSelectedTask("")

        if (textareaRef.current) {

            textareaRef.current.focus()
        }
    }

    async function submit(event: FormEvent) {

        event.preventDefault()

        const question = input.trim()

        if (!question || !model || !taskResource.solve || creation.isPending) return

        setInput("")

        const task = await creation.safeExecute(question, model)

        if (task) {

            setSelectedTask(task.id)

            return
        }

        setInput(current => current || question)
    }

    function keyboard(event: KeyboardEvent) {

        if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return

        event.preventDefault()

        textareaRef.current?.form?.requestSubmit()
    }

    async function changeReasoning(level: string | null) {

        if (!model || reasoningMutation.isPending) return

        const previous = model.reasoning

        setSelectedReasoning(level)

        if (!await reasoningMutation.safeExecute(model, level)) setSelectedReasoning(previous)
    }

    const reasoning = reasoningLevels.solve ?? null

    return <div className="tasks" aria-label="Lemo Tasks">
        <Surface className="task-sidebar" aria-label="Tasks">
            <div className="task-sidebar-header">
                <div className="task-sidebar-title">
                    <strong>Tasks</strong>
                    <span className="task-count">{taskResource.isPending ? "…" : tasks.length}</span>
                </div>

                <Button size="small"
                    className="new-task-button"
                    type="button"
                    aria-label="Start a new Task"
                    onPress={startNewTask}
                >
                    <span className="new-task-plus">+</span>
                    <span>New</span>
                </Button>
            </div>

            <div className="task-navigation" role="navigation" aria-label="Tasks">
                {taskResource.solve && activeTasks.map(task => <TaskLink
                    key={task.id}
                    task={task}
                    selected={task.id === selectedTask}
                    select={() => setSelectedTask(task.id)}
                />)}

                {taskResource.solve && recentTasks.length > 0 && <div className="task-section-separator">
                    <span>Recent</span>
                </div>}

                {taskResource.solve && recentTasks.map(task => <TaskLink
                    key={task.id}
                    task={task}
                    selected={task.id === selectedTask}
                    select={() => setSelectedTask(task.id)}
                />)}
            </div>
        </Surface>

        <div className="task-workspace">
            {!currentTask && <div className="task-list welcome-workspace" aria-live="polite">
                {taskResource.isPending && <ResourceState title="Loading your Tasks…" />}

                {taskResource.exception && <ResourceState
                    title="Lemo could not load your Tasks"
                    error={taskResource.exception.current}
                    retry={() => void taskResource.safeExecute()}
                />}

                {taskResource.solve && !currentTask && <div className="empty-state">
                    <strong>What should we work on?</strong>
                    <p>Describe a goal below to start a Task.</p>
                </div>}

            </div>}

            {currentTask && <TaskHistory task={currentTask} />}

            <form className="composer" onSubmit={submit}>
                <Textarea
                    ref={textareaRef}
                    aria-label="Task input"
                    rows={1}
                    placeholder={model ? "Message Lemo or ask to run a task…" : "Configure an active LLM Provider first."}
                    value={input}
                    onChange={setInput}
                    onKeyDown={keyboard}
                />

                <div className="composer-bar">
                    <div className={`model-selector-wrapper${reasoning ? " has-reasoning" : ""}`}>
                        <Input
                            size="small"
                            aria-label="Search LLM Models"
                            className="model-search"
                            type="search"
                            placeholder={models.length ? `Search ${models.length} Models` : "Search Models"}
                            value={modelSearch}
                            disabled={modelResource.isPending || !models.length}
                            onChange={setModelSearch}
                        />

                        <Select
                            size="small"
                            aria-label="LLM Model"
                            className="model-select"
                            value={model ? modelKey(model) : null}
                            placeholder={modelResource.isPending ? "Loading LLM Models…" : modelResource.exception ? "LLM Models unavailable" : "No LLM Models"}
                            disabled={modelResource.isPending || !models.length}
                            description={modelSearch.trim()
                                ? `${matchingModels.length} matching LLM Models`
                                : undefined}
                            onChange={value => {
                                setSelectedModel(value ?? "")
                                setModelSearch("")
                            }}
                            options={visibleModels.map(candidate => ({ value: modelKey(candidate), label: `${candidate.provider.name} · ${candidate.id}` }))}
                        />

                        {reasoning && <Select
                            size="small"
                            aria-label="Reasoning level"
                            className="reasoning-select"
                            value={selectedReasoning ?? ""}
                            disabled={reasoningMutation.isPending}
                            onChange={value => void changeReasoning(value || null)}
                            options={[
                                { value: "", label: reasoning.default ? `Default · ${reasoning.default}` : "Default reasoning" },
                                ...reasoning.levels.map(level => ({ value: level, label: level }))
                            ]}
                        />}
                    </div>

                    <span className="composer-hint">
                        <kbd>Enter ↵</kbd> send · <kbd>Shift + Enter</kbd> new line
                    </span>

                    <Button size="small"
                        color="primary"
                        type="submit"
                        disabled={!input.trim() || !model || !taskResource.solve || creation.isPending}
                    >
                        {creation.isPending ? "Starting…" : "Send"}
                    </Button>
                </div>

                {modelResource.exception && <div className="composer-error resource-error" role="alert">
                    <span>{message(modelResource.exception.current)}</span>
                    <Button size="small" type="button" onPress={() => void modelResource.safeExecute()}>Retry Models</Button>
                </div>}

                {creation.exception && <p className="composer-error" role="alert">
                    {message(creation.exception.current)}
                </p>}

                {(reasoningLevels.exception || reasoningMutation.exception) && <p className="composer-error" role="alert">
                    {message(reasoningMutation.exception?.current ?? reasoningLevels.exception?.current)}
                </p>}
            </form>
        </div>
    </div>
}

function TaskLink({ task, selected, select }: Readonly<{
    task: Task
    selected: boolean
    select(): void
}>) {

    const snapshot = useTask(task)

    return <Button size="small"
        className="task-link"
        color={selected ? "primary" : undefined}
        style={{ height: "auto", width: "100%", display: "grid", gridTemplateColumns: "minmax(0, 1fr)", justifyItems: "stretch", paddingBlock: "var(--spacing)", textAlign: "start" }}
        data-status={snapshot.status}
        aria-current={selected ? "page" : undefined}
        type="button"
        onPress={select}
    >
        <span className="task-link-content">
            <span className="task-link-title">{taskQuestion(snapshot.operations)}</span>
            <span className="task-link-meta">
                <span className={`status-badge status-${snapshot.status}`}>
                    <i className="status-badge-dot" />
                    {statusLabel(snapshot.status)}
                </span>
            </span>
        </span>
    </Button>
}

function TaskHistory({ task }: Readonly<{ task: Task }>) {

    const history = useRef<HTMLDivElement>(null)

    const followsLatest = useRef(true)

    const currentTask = useRef(task.id)

    const snapshot = useTask(task)

    useLayoutEffect(function () {

        const element = history.current

        if (!element) return

        if (currentTask.current !== task.id) {

            currentTask.current = task.id
            followsLatest.current = true
        }

        if (followsLatest.current) element.scrollTop = element.scrollHeight

    }, [task.id, snapshot.operations])

    return <div
        className="task-list"
        ref={history}
        aria-live="polite"
        onScroll={event => {

            const element = event.currentTarget

            followsLatest.current = element.scrollHeight - element.scrollTop - element.clientHeight <= 48
        }}
    >
        <TaskView task={task} snapshot={snapshot} />
    </div>
}

function TaskView({ task, snapshot }: Readonly<{
    task: Task
    snapshot: TaskViewSnapshot
}>) {

    const events = task.timeline()
    const earlier = usePromise(() => task.loadEarlierOperations())

    return <div className="task" data-status={snapshot.status}>
        <TaskControls task={task} status={snapshot.status} />

        {task.hasEarlierOperations && <div className="history-pagination">
            <Button size="small"
                type="button"
                disabled={earlier.isPending}
                onPress={() => void earlier.safeExecute()}
            >
                {earlier.isPending ? "Loading earlier activity…" : "Load earlier activity"}
            </Button>
            {earlier.exception && <span role="alert">{message(earlier.exception.current)}</span>}
        </div>}

        {events.map(event => event.type === "input"
            ? <div className="user-message-container" key={event.key}>
                <Surface className="user-message">
                    <p>{event.content}</p>
                </Surface>
            </div>
            : event.type === "output"
                ? <div className="assistant-message" key={event.key}>
                    <div className="assistant-header">
                        <img className="assistant-avatar" src={icon} alt="" />
                        <strong className="event-author">Lemo</strong>
                    </div>
                    <MarkdownMessage content={event.content} />
                </div>
                : event.type === "usage"
                    ? <CycleUsage
                        key={event.key}
                        usage={event.usage}
                        contextWindow={event.contextWindow}
                    />
                : event.type === "tool"
                    ? <ToolView key={event.key} tool={event.tool} />
                    : <div className="assistant-message failure-message" key={event.key}>
                        <div className="assistant-header">
                            <span className="assistant-avatar failure-avatar">!</span>
                            <strong className="event-author">Lemo</strong>
                        </div>
                        <p role="alert" className="failure-text">{event.content}</p>
                    </div>)}

        {snapshot.status === "running" && <div className="working-container">
            <div className="working" aria-label="Lemo is working">
                <span className="working-dot" />
                <span>Lemo is working…</span>
            </div>
        </div>}

        {snapshot.error && <p role="alert" className="task-error-alert">{snapshot.error.message}</p>}
    </div>
}

function CycleUsage({ usage, contextWindow }: Readonly<{
    usage: Extract<ReturnType<Task["timeline"]>[number], { type: "usage" }>["usage"]
    contextWindow: number | null
}>) {

    const contextTokens = usage.input.tokens + usage.output.tokens
    const values = [
        `${formatNumber(usage.input.tokens)} input`,
        ...(usage.input.cachedTokens === undefined ? [] : [`${formatNumber(usage.input.cachedTokens)} cached`]),
        `${formatNumber(usage.output.tokens)} output`,
        ...(usage.output.reasoningTokens === undefined ? [] : [`${formatNumber(usage.output.reasoningTokens)} reasoning`]),
        ...(contextWindow === null ? [] : [`${Math.round(contextTokens / contextWindow * 100)}% context`])
    ]

    return <small className="cycle-usage">{values.join(" · ")}</small>
}

function formatNumber(value: number) {

    return new Intl.NumberFormat().format(value)
}

function TaskControls({ task, status }: Readonly<{ task: Task; status: Task["status"] }>) {

    const pause = usePromise(() => task.pause())

    const continuation = usePromise(() => task.continue())

    const cancellation = usePromise(() => task.cancel())

    const pending = pause.isPending || continuation.isPending || cancellation.isPending

    const failure = pause.exception?.current
        ?? continuation.exception?.current
        ?? cancellation.exception?.current

    return <div className="task-controls">
        <div className="task-status-wrapper">
            <span className={`task-status-pill status-${status}`} data-status={status}>
                <i className="status-dot" />
                {statusLabel(status)}
            </span>
        </div>

        <div className="task-action-buttons">
            {status === "running" && <Button size="small"
                type="button"
                disabled={pending}
                onPress={() => void pause.safeExecute()}
            >{pause.isPending ? "Pausing…" : "⏸ Pause"}</Button>}

            {status === "paused" && <Button size="small"
                type="button"
                disabled={pending}
                onPress={() => void continuation.safeExecute()}
            >{continuation.isPending ? "Continuing…" : "▶ Continue"}</Button>}

            {(status === "running" || status === "paused") && <Button size="small"
                color="danger"
                type="button"
                disabled={pending}
                onPress={() => void cancellation.safeExecute()}
            >{cancellation.isPending ? "Cancelling…" : "✕ Cancel"}</Button>}
        </div>

        {failure !== undefined && <small role="alert" className="task-controls-error">{message(failure)}</small>}
    </div>
}

function ResourceState({ title, error, retry }: Readonly<{
    title: string
    error?: unknown
    retry?: () => void
}>) {

    return <div className="resource-state">
        <strong>{title}</strong>
        {error !== undefined && <small role="alert">{message(error)}</small>}
        {retry && <Button size="small"  type="button" onPress={retry}>Retry</Button>}
    </div>
}

function CodeBlock({ language, content }: Readonly<{ language: string; content: string }>) {

    const [copied, setCopied] = useState(false)

    async function copy() {

        try {

            if (navigator.clipboard?.writeText) {

                await navigator.clipboard.writeText(content)
                setCopied(true)
                setTimeout(() => setCopied(false), 2000)
            }

        } catch {
            // ignore
        }
    }

    return <Surface className="code-block-wrapper">
        <div className="code-block-header">
            <span className="code-language-tag">{language || "code"}</span>
            <Button size="small"
                type="button"
                className={`copy-code-btn${copied ? " copied" : ""}`}
                onPress={copy}
                aria-label="Copy code"
            >
                {copied ? "Copied ✓" : "Copy"}
            </Button>
        </div>
        <pre className="code-pre">
            <code>{content}</code>
        </pre>
    </Surface>
}

const markdownComponents: Components = {
    a({ node, ...properties }) {

        void node

        return <a {...properties} target="_blank" rel="noreferrer" />
    },
    pre({ children }) {

        return <>{children}</>
    },
    code({ node, className, children, ...props }) {

        void node

        const match = /language-(\w+)/.exec(className || "")
        const content = String(children)
        const isMultiline = content.includes("\n")

        if (match || isMultiline) {

            return <CodeBlock language={match ? match[1] : ""} content={content.replace(/\n$/, "")} />
        }

        return <code className={className} {...props}>{children}</code>
    }
}

function MarkdownMessage({ content }: Readonly<{ content: string }>) {

    return <div className="markdown">
        <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{content}</Markdown>
    </div>
}

function taskQuestion(operations: ReturnType<Task["operations"]>) {

    const input = operations.find(operation => operation.kind === "task.input")

    return text(record(input?.payload)?.input) || "Task"
}

function statusLabel(status: Task["status"]) {

    if (status === "running") return "Working"

    if (status === "failed") return "Failed"

    if (status === "paused") return "Paused"

    if (status === "cancelled") return "Cancelled"

    return "Completed"
}

function modelKey(model: LLMModel) {

    return `${model.provider.identity}/${model.id}`
}

function useTask(task: Task): TaskViewSnapshot {

    const subscribe = useCallback((listener: () => void) => task.subscribe(listener), [task])

    const snapshot = useCallback(() => task.operations(), [task])

    const operations = useSyncExternalStore(subscribe, snapshot, snapshot)

    return { operations, status: task.status, error: task.error }
}

function useTasks(lemo: Application["lemo"]) {

    const subscribe = useCallback((listener: () => void) => lemo.subscribe(listener), [lemo])

    const snapshot = useCallback(() => lemo.tasks(), [lemo])

    return useSyncExternalStore(subscribe, snapshot, snapshot)
}

function executing(status: Task["status"]) {

    return status === "running" || status === "paused"
}

function message(value: unknown) {

    return value instanceof Error ? value.message : String(value)
}

function text(value: unknown) {

    return typeof value === "string" ? value : ""
}

function record(value: unknown) {

    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null
}

type TaskViewSnapshot = Readonly<{
    operations: ReturnType<Task["operations"]>
    status: Task["status"]
    error: Error | null
}>

type Properties = Readonly<{
    application: Application
    models: PromiseWithDependencies<readonly LLMModel[]>
}>
