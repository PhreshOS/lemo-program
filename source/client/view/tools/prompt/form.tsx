import type {
    PromptField,
    PromptRequest,
    PromptValue
} from "@server/core/lemo/runtime/tools/prompt/contract"
import { validatePromptValues } from "@server/core/lemo/runtime/tools/prompt/contract"
import type Tool from "@client/core/lemo/tool"
import type { ToolSnapshot } from "@client/core/lemo/tool"
import { useState, type FormEvent } from "react"

type FormRequest = Extract<PromptRequest, { type: "form" }>
type Values = Record<string, PromptValue | undefined>

export default function PromptForm({ tool, snapshot, request, report }: Readonly<{
    tool: Tool
    snapshot: ToolSnapshot
    request: FormRequest
    report(error: string): void
}>) {

    const [values, setValues] = useState<Values>(() => initialValues(request.fields))

    function change(key: string, value: PromptValue | undefined) {

        setValues(current => ({ ...current, [key]: value }))
    }

    function submit(event: FormEvent<HTMLFormElement>) {

        event.preventDefault()
        report("")

        try {
            const submitted = Object.fromEntries(
                Object.entries(values).filter((entry): entry is [string, PromptValue] => entry[1] !== undefined)
            )

            validatePromptValues(request, submitted)
            void tool.respond({ type: "submitted", values: submitted }).catch(cause => report(
                cause instanceof Error ? cause.message : String(cause)
            ))
        } catch (cause) {
            report(cause instanceof Error ? cause.message : String(cause))
        }
    }

    return <form className="prompt-form" onSubmit={submit}>
        {request.content && <p>{request.content}</p>}

        <div className="prompt-fields">
            {request.fields.map(field => <PromptFieldView
                key={field.key}
                field={field}
                value={values[field.key]}
                disabled={snapshot.isResponding}
                change={value => change(field.key, value)}
            />)}
        </div>

        <button className="primary" type="submit" disabled={snapshot.isResponding}>
            {snapshot.isResponding ? "Sending…" : request.submit ?? "Submit"}
        </button>
    </form>
}

function PromptFieldView({ field, value, disabled, change }: Readonly<{
    field: PromptField
    value: PromptValue | undefined
    disabled: boolean
    change(value: PromptValue | undefined): void
}>) {

    const identity = `prompt-field-${field.key}`

    if (field.type === "boolean" || field.type === "confirmation") {
        return <label className="prompt-field prompt-check" htmlFor={identity}>
            <input
                id={identity}
                type="checkbox"
                checked={value === true}
                required={field.type === "confirmation" && field.required}
                disabled={disabled}
                onChange={event => change(event.target.checked)}
            />
            <span>
                <strong>{field.label}</strong>
                {field.description && <small>{field.description}</small>}
            </span>
        </label>
    }

    return <label className="prompt-field" htmlFor={identity}>
        <strong>{field.label}</strong>
        {field.description && <small>{field.description}</small>}
        <FieldControl
            identity={identity}
            field={field}
            value={value}
            disabled={disabled}
            change={change}
        />
    </label>
}

function FieldControl({ identity, field, value, disabled, change }: Readonly<{
    identity: string
    field: Exclude<PromptField, { type: "boolean" | "confirmation" }>
    value: PromptValue | undefined
    disabled: boolean
    change(value: PromptValue | undefined): void
}>) {

    if (field.type === "textarea") {
        return <textarea
            id={identity}
            rows={4}
            value={typeof value === "string" ? value : ""}
            placeholder={field.placeholder}
            required={field.required}
            disabled={disabled}
            onChange={event => change(event.target.value)}
        />
    }

    if (field.type === "number") {
        return <input
            id={identity}
            type="number"
            value={typeof value === "number" ? value : ""}
            min={field.minimum}
            max={field.maximum}
            step={field.step}
            required={field.required}
            disabled={disabled}
            onChange={event => change(event.target.value === "" ? undefined : event.target.valueAsNumber)}
        />
    }

    if (field.type === "select") {
        return <select
            id={identity}
            value={typeof value === "string" ? value : ""}
            required={field.required}
            disabled={disabled}
            onChange={event => change(event.target.value || undefined)}
        >
            <option value="">Select…</option>
            {field.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
    }

    if (field.type === "multi-select") {
        return <select
            id={identity}
            multiple
            value={Array.isArray(value) ? value.filter(item => typeof item === "string") : []}
            required={field.required}
            disabled={disabled}
            onChange={event => change([...event.target.selectedOptions].map(option => option.value))}
        >
            {field.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
    }

    return <input
        id={identity}
        type={field.type === "date" ? "date" : "text"}
        value={typeof value === "string" ? value : ""}
        placeholder={field.type === "text" ? field.placeholder : undefined}
        required={field.required}
        disabled={disabled}
        onChange={event => change(event.target.value || undefined)}
    />
}

function initialValues(fields: readonly PromptField[]): Values {

    return Object.fromEntries(fields.map(field => [
        field.key,
        field.value ?? (field.type === "boolean" || field.type === "confirmation" ? false : undefined)
    ]))
}
