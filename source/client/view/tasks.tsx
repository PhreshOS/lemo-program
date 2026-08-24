import type Application from "@client/core/application"
import type Task from "@client/core/lemo/task"
import type OllamaCloudModel from "@client/core/llm/providers/ollama-cloud/model"
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react"

const visibleTaskLimit = 20

export default function Tasks({ application, models }: Properties) {

    const [tasks, setTasks] = useState<readonly Task[]>([])
    const [input, setInput] = useState("")
    const [selected, setSelected] = useState("")
    const [error, setError] = useState("")
    const [revision, render] = useState(0)
    const history = useRef<HTMLDivElement>(null)

    const available = useMemo(() => new Map(models.map(model => [modelKey(model), model])), [models])

    const model = available.get(selected) ?? models[0] ?? null

    useEffect(function () {

        if (model && selected !== modelKey(model)) setSelected(modelKey(model))

    }, [model, selected])

    useEffect(function () {

        let active = true

        void application.lemo.tasks().then(value => {

            if (active) setTasks(value.slice(-visibleTaskLimit))
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

    }, [tasks, revision])

    function submit(event: FormEvent) {

        event.preventDefault()

        const question = input.trim()

        if (!question || !model) return

        setInput("")

        setError("")

        void application.lemo.task({ input: question, model }).then(task => {

            setTasks(current => [...current, task].slice(-visibleTaskLimit))
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
        <div className="task-list" ref={history} aria-live="polite">
            {!tasks.length && <div className="empty-state">
                <strong>What should we work on?</strong>
                <p>Start a Task below. Every Task runs independently, so you can submit another while Lemo works.</p>
            </div>}

            {tasks.map(task => <TaskView key={task.id} task={task} />)}
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
                    onChange={event => setSelected(event.target.value)}
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
    </section>
}

function TaskView({ task }: Readonly<{ task: Task }>) {

    const history = task.operations()

    const input = history.find(operation => operation.kind === "task.input")

    const question = text(record(input?.payload)?.input) || "Task"

    const messages = history
        .filter(operation => operation.kind === "model.message")
        .map(operation => text(record(operation.payload)?.content))
        .filter(Boolean)

    const finalMessage = text(record(history.findLast(operation => operation.kind === "task.completed")?.payload)?.output)

    const response = finalMessage || messages.at(-1) || streamingText(history)

    const activity = toolActivity(history)

    return <article className="task" data-status={task.status}>
        <div className="user-message">{question}</div>

        <div className="assistant-message">
            <div className="assistant-heading">
                <strong>Lemo</strong>
                <span className="task-status">{statusLabel(task.status)}</span>
            </div>

            {activity.total > 0 && <details className="activity">
                <summary>{activityLabel(activity)}</summary>

                <div className="activity-groups">
                    {activity.groups.map(group => <div key={group.name}>
                        <strong>{group.name}</strong>
                        <span>{groupLabel(group)}</span>
                    </div>)}
                </div>
            </details>}

            {response
                ? <div className="response">{response}</div>
                : task.status === "running" && <div className="working" aria-label="Lemo is working">
                    <i />
                    <i />
                    <i />
                </div>}

            {task.error && <p role="alert">{task.error.message}</p>}
        </div>
    </article>
}

function toolActivity(operations: ReturnType<Task["operations"]>) {

    const groups = new Map<string, ToolGroup>()

    for (const operation of operations) {

        const payload = record(operation.payload)

        if (operation.kind === "model.event" && payload?.type === "tool-call") {

            const call = record(payload.call)

            if (typeof call?.name !== "string") continue

            const group = groups.get(call.name) ?? { name: call.name, calls: 0, completed: 0, failed: 0 }

            group.calls++

            groups.set(call.name, group)
        }

        if (operation.kind === "tool.result" && typeof payload?.name === "string") {

            const group = groups.get(payload.name) ?? { name: payload.name, calls: 0, completed: 0, failed: 0 }

            if (payload.ok === true) group.completed++
            else group.failed++

            groups.set(payload.name, group)
        }
    }

    const values = [...groups.values()]

    return {
        total: values.reduce((total, group) => total + group.calls, 0),
        failed: values.reduce((total, group) => total + group.failed, 0),
        pending: values.reduce((total, group) => total + Math.max(0, group.calls - group.completed - group.failed), 0),
        groups: values
    }
}

function activityLabel(activity: ReturnType<typeof toolActivity>) {

    const calls = `${activity.total} tool ${activity.total === 1 ? "call" : "calls"}`

    if (activity.pending) return `${calls} · ${activity.pending} active`

    if (activity.failed) return `${calls} · ${activity.failed} failed`

    return calls
}

function groupLabel(group: ToolGroup) {

    const values = []

    if (group.completed) values.push(`${group.completed} completed`)

    if (group.failed) values.push(`${group.failed} failed`)

    const pending = Math.max(0, group.calls - group.completed - group.failed)

    if (pending) values.push(`${pending} active`)

    return values.join(" · ") || `${group.calls} requested`
}

function statusLabel(status: Task["status"]) {

    if (status === "running") return "Working"

    if (status === "failed") return "Failed"

    return "Completed"
}

function streamingText(operations: ReturnType<Task["operations"]>) {

    const lastMessage = operations.findLastIndex(operation => operation.kind === "model.message")

    return operations.slice(lastMessage + 1).flatMap(operation => {

        if (operation.kind !== "model.event") return []

        const payload = record(operation.payload)

        return payload?.type === "text" ? text(payload.content) : []
    }).join("")
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

type ToolGroup = {
    name: string
    calls: number
    completed: number
    failed: number
}

type Properties = Readonly<{
    application: Application
    models: readonly OllamaCloudModel[]
}>
