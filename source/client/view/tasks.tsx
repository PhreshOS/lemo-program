import type Application from "@client/core/application"
import type Task from "@client/core/lemo/task"
import type OllamaCloudModel from "@client/core/llm/providers/ollama-cloud/model"
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react"
import Markdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"

const visibleTaskLimit = 20

export default function Tasks({ application, models }: Properties) {

    const [tasks, setTasks] = useState<readonly Task[]>([])
    const [input, setInput] = useState("")
    const [selectedModel, setSelectedModel] = useState("")
    const [selectedTask, setSelectedTask] = useState("")
    const [error, setError] = useState("")
    const [revision, render] = useState(0)
    const history = useRef<HTMLDivElement>(null)
    const submission = useRef(0)

    const available = useMemo(() => new Map(models.map(model => [modelKey(model), model])), [models])

    const model = available.get(selectedModel) ?? models[0] ?? null

    const currentTask = tasks.find(task => task.id === selectedTask) ?? null

    useEffect(function () {

        if (model && selectedModel !== modelKey(model)) setSelectedModel(modelKey(model))

    }, [model, selectedModel])

    useEffect(function () {

        let active = true

        void application.lemo.tasks().then(value => {

            if (!active) return

            const visible = value.slice(-visibleTaskLimit)

            setTasks(visible)
            setSelectedTask(current => current || visible.at(-1)?.id || "")
        }).catch(failure => {

            if (active) setError(message(failure))
        })

        return () => {

            active = false
        }

    }, [application])

    useEffect(function () {

        return combine(tasks.map(task => task.subscribe(() => render(value => value + 1))))

    }, [tasks])

    useEffect(function () {

        history.current?.scrollTo({ top: history.current.scrollHeight, behavior: "smooth" })

    }, [selectedTask, revision])

    function submit(event: FormEvent) {

        event.preventDefault()

        const question = input.trim()

        if (!question || !model) return

        setInput("")

        setError("")

        const request = ++submission.current

        void application.lemo.task({ input: question, model }).then(task => {

            setTasks(current => [...current.filter(candidate => candidate.id !== task.id), task].slice(-visibleTaskLimit))

            if (request === submission.current) setSelectedTask(task.id)
        }).catch(failure => {

            setError(message(failure))

            setInput(current => current || question)
        })
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
                <span>{tasks.length}</span>
            </header>

            <nav className="task-navigation">
                {[...tasks].reverse().map(task => <button
                    className="task-link"
                    data-status={task.status}
                    aria-current={task.id === selectedTask ? "page" : undefined}
                    key={task.id}
                    type="button"
                    onClick={() => setSelectedTask(task.id)}
                >
                    <span>{taskQuestion(task)}</span>
                    <small>{statusLabel(task.status)}</small>
                </button>)}
            </nav>
        </aside>

        <div className="task-workspace">
            <div className="task-list" ref={history} aria-live="polite">
                {!currentTask && <div className="empty-state">
                    <strong>What should we work on?</strong>
                    <p>Start a Task below. Every Task runs independently, so you can submit another while Lemo works.</p>
                </div>}

                {currentTask && <TaskView task={currentTask} />}
            </div>

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
                        disabled={!models.length}
                        onChange={event => setSelectedModel(event.target.value)}
                    >
                        {!models.length && <option value="">No LLM Models</option>}
                        {models.map(candidate => <option key={modelKey(candidate)} value={modelKey(candidate)}>
                            {candidate.provider.name} · {candidate.id}
                        </option>)}
                    </select>

                    <span className="composer-hint">Enter to send · Shift Enter for a new line</span>

                    <button className="primary" type="submit" disabled={!input.trim() || !model}>Send</button>
                </div>

                {error && <p className="composer-error" role="alert">{error}</p>}
            </form>
        </div>
    </section>
}

function TaskView({ task }: Readonly<{ task: Task }>) {

    const history = task.operations()

    const events = timeline(history)

    return <article className="task" data-status={task.status}>
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

        {task.status === "running" && <div className="working" aria-label="Lemo is working">
            <i />
            <i />
            <i />
        </div>}

        {task.error && <p role="alert">{task.error.message}</p>}
    </article>
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

function taskQuestion(task: Task) {

    const input = task.operations().find(operation => operation.kind === "task.input")

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

    return "Completed"
}

function modelKey(model: OllamaCloudModel) {

    return `${model.provider.identity}/${model.id}`
}

function combine(dispose: readonly (() => void)[]) {

    return () => {

        for (const value of dispose) value()
    }
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
    models: readonly OllamaCloudModel[]
}>
