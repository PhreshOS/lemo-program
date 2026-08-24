import type Application from "@client/core/application"
import type Task from "@client/core/lemo/task"
import type LLMModel from "@client/core/llm/model"
import type Prompt from "@client/core/prompts/prompt"
import usePromise, { type PromiseWithDependencies } from "@libs/react-promise"
import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    useSyncExternalStore,
    type FormEvent,
    type KeyboardEvent
} from "react"
import Markdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"

const visibleTaskLimit = 20

export default function Tasks({ application, models: modelResource }: Properties) {

    const [input, setInput] = useState("")
    const [selectedModel, setSelectedModel] = useState("")
    const [selectedTask, setSelectedTask] = useState("")

    const taskResource = usePromise(async function () {

        return (await application.lemo.tasks()).slice(-visibleTaskLimit)

    }, [application])

    const creation = usePromise((question: string, model: LLMModel) => (
        application.lemo.task({ input: question, model })
    ))

    const tasks = taskResource.solve ?? []

    const models = modelResource.solve ?? []

    const prompts = usePrompts(application.prompts)

    const available = useMemo(() => new Map(models.map(model => [modelKey(model), model])), [models])

    const model = available.get(selectedModel) ?? models[0] ?? null

    const currentTask = tasks.find(task => task.id === selectedTask) ?? null

    useEffect(function () {

        if (model && selectedModel !== modelKey(model)) setSelectedModel(modelKey(model))

    }, [model, selectedModel])

    useEffect(function () {

        if (!taskResource.solve) return

        setSelectedTask(current => (
            taskResource.solve.some(task => task.id === current)
                ? current
                : taskResource.solve.at(-1)?.id ?? ""
        ))

    }, [taskResource.solve])

    async function submit(event: FormEvent) {

        event.preventDefault()

        const question = input.trim()

        if (!question || !model || !taskResource.solve || creation.isPending) return

        setInput("")

        const task = await creation.safeExecute(question, model)

        if (task) {

            taskResource.dispatch(current => [
                ...current.filter(candidate => candidate.id !== task.id),
                task
            ].slice(-visibleTaskLimit))

            setSelectedTask(task.id)

            return
        }

        setInput(current => current || question)
    }

    function keyboard(event: KeyboardEvent<HTMLTextAreaElement>) {

        if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return

        event.preventDefault()

        event.currentTarget.form?.requestSubmit()
    }

    return <section className="tasks" aria-label="Lemo Tasks">
        <aside className="task-sidebar" aria-label="Tasks">
            <header>
                <strong>Tasks</strong>
                <span>{taskResource.isPending ? "…" : tasks.length}</span>
            </header>

            <nav className="task-navigation">
                {taskResource.isPending && <ResourceState title="Loading Tasks…" />}

                {taskResource.exception && <ResourceState
                    title="Tasks unavailable"
                    error={taskResource.exception.current}
                    retry={() => void taskResource.safeExecute()}
                />}

                {taskResource.solve && [...tasks].reverse().map(task => <TaskLink
                    key={task.id}
                    task={task}
                    selected={task.id === selectedTask}
                    select={() => setSelectedTask(task.id)}
                />)}
            </nav>
        </aside>

        <div className="task-workspace">
            {!currentTask && <div className="task-list" aria-live="polite">
                {taskResource.isPending && <ResourceState title="Loading your Tasks…" />}

                {taskResource.exception && <ResourceState
                    title="Lemo could not load your Tasks"
                    error={taskResource.exception.current}
                    retry={() => void taskResource.safeExecute()}
                />}

                {taskResource.solve && !currentTask && <div className="empty-state">
                    <strong>What should we work on?</strong>
                    <p>Start a Task below. Every Task runs independently, so you can submit another while Lemo works.</p>
                </div>}

            </div>}

            {currentTask && <TaskHistory
                task={currentTask}
                prompts={prompts.filter(prompt => prompt.task === currentTask.id)}
            />}

            <form className="composer" onSubmit={submit}>
                <textarea
                    aria-label="Task input"
                    rows={2}
                    placeholder={model ? "Message Lemo…" : "Configure an active LLM Provider first."}
                    value={input}
                    onChange={event => setInput(event.target.value)}
                    onKeyDown={keyboard}
                />

                <div className="composer-bar">
                    <select
                        aria-label="LLM Model"
                        value={model ? modelKey(model) : ""}
                        disabled={modelResource.isPending || !models.length}
                        onChange={event => setSelectedModel(event.target.value)}
                    >
                        {modelResource.isPending && <option value="">Loading LLM Models…</option>}
                        {modelResource.exception && <option value="">LLM Models unavailable</option>}
                        {modelResource.solve && !models.length && <option value="">No LLM Models</option>}
                        {models.map(candidate => <option key={modelKey(candidate)} value={modelKey(candidate)}>
                            {candidate.provider.name} · {candidate.id}
                        </option>)}
                    </select>

                    <span className="composer-hint">Enter to send · Shift Enter for a new line</span>

                    <button
                        className="primary"
                        type="submit"
                        disabled={!input.trim() || !model || !taskResource.solve || creation.isPending}
                    >{creation.isPending ? "Starting…" : "Send"}</button>
                </div>

                {modelResource.exception && <div className="composer-error resource-error" role="alert">
                    <span>{message(modelResource.exception.current)}</span>
                    <button type="button" onClick={() => void modelResource.safeExecute()}>Retry Models</button>
                </div>}

                {creation.exception && <p className="composer-error" role="alert">
                    {message(creation.exception.current)}
                </p>}
            </form>
        </div>
    </section>
}

function TaskLink({ task, selected, select }: Readonly<{
    task: Task
    selected: boolean
    select(): void
}>) {

    const snapshot = useTask(task)

    return <button
        className="task-link"
        data-status={snapshot.status}
        aria-current={selected ? "page" : undefined}
        type="button"
        onClick={select}
    >
        <span>{taskQuestion(snapshot.operations)}</span>
        <small>{statusLabel(snapshot.status)}</small>
    </button>
}

function TaskHistory({ task, prompts }: Readonly<{ task: Task; prompts: readonly Prompt[] }>) {

    const history = useRef<HTMLDivElement>(null)

    const snapshot = useTask(task)

    useEffect(function () {

        history.current?.scrollTo({ top: history.current.scrollHeight, behavior: "smooth" })

    }, [snapshot.operations])

    return <div className="task-list" ref={history} aria-live="polite">
        <TaskView task={task} snapshot={snapshot} prompts={prompts} />
    </div>
}

function TaskView({ task, snapshot, prompts }: Readonly<{
    task: Task
    snapshot: TaskViewSnapshot
    prompts: readonly Prompt[]
}>) {

    const events = timeline(snapshot.operations)

    return <article className="task" data-status={snapshot.status}>
        <TaskControls task={task} status={snapshot.status} />

        {events.map(event => event.type === "user"
            ? <div className="user-message" key={event.key}>{event.content}</div>
            : event.type === "message"
                ? <div className="assistant-message" key={event.key}>
                    <strong className="event-author">Lemo</strong>
                    <MarkdownMessage content={event.content} />
                </div>
                : event.type === "tool"
                    ? <div className="runtime-message" key={event.key}>
                        <strong className="event-author">Runtime</strong>
                        <div className="tool-event" data-status={event.status}>
                            <code>{event.name}</code>
                            <span>{toolStatus(event.status)}</span>
                            {event.error && <small>{event.error}</small>}
                        </div>
                    </div>
                    : <div className="assistant-message failure-message" key={event.key}>
                        <strong className="event-author">Lemo</strong>
                        <p role="alert">{event.content}</p>
                    </div>)}

        {prompts.map(prompt => <PromptView
            key={prompt.id}
            prompt={prompt}
            responding={prompt.isResponding}
        />)}

        {snapshot.status === "running" && <div className="working" aria-label="Lemo is working">
            <i />
            <i />
            <i />
        </div>}

        {snapshot.error && <p role="alert">{snapshot.error.message}</p>}
    </article>
}

function TaskControls({ task, status }: Readonly<{ task: Task; status: Task["status"] }>) {

    const pause = usePromise(() => task.pause())

    const continuation = usePromise(() => task.continue())

    const cancellation = usePromise(() => task.cancel())

    const pending = pause.isPending || continuation.isPending || cancellation.isPending

    const failure = pause.exception?.current
        ?? continuation.exception?.current
        ?? cancellation.exception?.current

    return <header className="task-controls">
        <span data-status={status}>{statusLabel(status)}</span>

        <div>
            {status === "running" && <button
                className="quiet"
                type="button"
                disabled={pending}
                onClick={() => void pause.safeExecute()}
            >{pause.isPending ? "Pausing…" : "Pause"}</button>}

            {status === "paused" && <button
                className="quiet"
                type="button"
                disabled={pending}
                onClick={() => void continuation.safeExecute()}
            >{continuation.isPending ? "Continuing…" : "Continue"}</button>}

            {(status === "running" || status === "paused") && <button
                className="quiet danger"
                type="button"
                disabled={pending}
                onClick={() => void cancellation.safeExecute()}
            >{cancellation.isPending ? "Cancelling…" : "Cancel"}</button>}
        </div>

        {failure !== undefined && <small role="alert">{message(failure)}</small>}
    </header>
}

function ResourceState({ title, error, retry }: Readonly<{
    title: string
    error?: unknown
    retry?: () => void
}>) {

    return <div className="resource-state">
        <strong>{title}</strong>
        {error !== undefined && <small role="alert">{message(error)}</small>}
        {retry && <button className="quiet" type="button" onClick={retry}>Retry</button>}
    </div>
}

function PromptView({ prompt, responding }: Readonly<{ prompt: Prompt; responding: boolean }>) {

    const [content, setContent] = useState("")
    const [error, setError] = useState("")

    function submit(event: FormEvent) {

        event.preventDefault()

        if (!content.trim() || responding) return

        setError("")

        try {
            prompt.respond(content)
        } catch (cause) {
            setError(message(cause))
        }
    }

    return <section className="client-prompt" aria-label="Lemo needs your response">
        <header>
            <strong>Lemo needs your response</strong>
            <span>Waiting</span>
        </header>

        <p>{prompt.content}</p>

        <form onSubmit={submit}>
            <textarea
                rows={2}
                aria-label="Response"
                placeholder="Type your response…"
                value={content}
                disabled={responding}
                onChange={event => setContent(event.target.value)}
                onKeyDown={promptKeyboard}
            />

            <button className="primary" type="submit" disabled={!content.trim() || responding}>
                {responding ? "Sending…" : "Respond"}
            </button>
        </form>

        {error && <small role="alert">{error}</small>}
    </section>
}

function promptKeyboard(event: KeyboardEvent<HTMLTextAreaElement>) {

    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return

    event.preventDefault()

    event.currentTarget.form?.requestSubmit()
}

const markdownComponents: Components = {
    a({ node, ...properties }) {

        void node

        return <a {...properties} target="_blank" rel="noreferrer" />
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

function timeline(operations: ReturnType<Task["operations"]>): readonly TimelineEvent[] {

    const results = toolResults(operations)
    const events: TimelineEvent[] = []
    let cycleHasText = false

    for (const operation of operations) {

        const payload = record(operation.payload)

        if (operation.kind === "task.input") {

            const content = text(payload?.input)

            if (content) events.push({ type: "user", key: operation.id, content })
        }

        if (operation.kind === "cycle.started") cycleHasText = false

        if (operation.kind === "model.event" && payload?.type === "text") {

            const content = text(payload.content)

            if (!content) continue

            cycleHasText = true

            const previous = events.at(-1)

            if (previous?.type === "message") previous.content += content
            else events.push({ type: "message", key: operation.id, content })
        }

        if (operation.kind === "model.event" && payload?.type === "tool-call") {

            const call = record(payload.call)
            const id = text(call?.id)
            const name = text(call?.name)

            if (!id || !name) continue

            const result = results.get(id)

            events.push({
                type: "tool",
                key: operation.id,
                name,
                status: result ? result.ok ? "completed" : "failed" : "running",
                error: result?.error
            })
        }

        if (operation.kind === "model.message" && !cycleHasText) {

            const content = text(payload?.content)

            if (content) events.push({ type: "message", key: operation.id, content })
        }

        if (operation.kind === "task.failed") {

            events.push({
                type: "failure",
                key: operation.id,
                content: text(payload?.message) || "The Task failed"
            })
        }
    }

    return events
}

function toolResults(operations: ReturnType<Task["operations"]>) {

    const results = new Map<string, ToolResult>()

    for (const operation of operations) {

        if (operation.kind !== "tool.result") continue

        const payload = record(operation.payload)
        const call = text(payload?.call)

        if (!call) continue

        results.set(call, {
            ok: payload?.ok === true,
            error: payload?.ok === true ? undefined : text(payload?.error) || "The tool failed"
        })
    }

    return results
}

function toolStatus(status: ToolStatus) {

    if (status === "running") return "Running…"

    if (status === "failed") return "Failed"

    return "Completed"
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

function usePrompts(prompts: Application["prompts"]) {

    const subscribe = useCallback((listener: () => void) => prompts.subscribe(listener), [prompts])

    const snapshot = useCallback(() => prompts.all(), [prompts])

    return useSyncExternalStore(subscribe, snapshot, snapshot)
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

type ToolStatus = "running" | "completed" | "failed"

type TaskViewSnapshot = Readonly<{
    operations: ReturnType<Task["operations"]>
    status: Task["status"]
    error: Error | null
}>

type ToolResult = Readonly<{
    ok: boolean
    error?: string
}>

type TimelineEvent = {
    type: "user" | "message" | "failure"
    key: string
    content: string
} | {
    type: "tool"
    key: string
    name: string
    status: ToolStatus
    error?: string
}

type Properties = Readonly<{
    application: Application
    models: PromiseWithDependencies<readonly LLMModel[]>
}>
