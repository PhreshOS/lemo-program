import { Button, Checkbox, Input, Select, Surface, Textarea } from "@phreshos/react-ui"
import type {
    PromptField,
    PromptRequest,
    PromptValue
} from "@server/core/lemo/runtime/tools/prompt/contract"
import { validatePromptValues } from "@server/core/lemo/runtime/tools/prompt/contract"
import type Tool from "@client/core/lemo/tool"
import type { ToolSnapshot } from "@client/core/lemo/tool"
import { useId, useState, type FormEvent } from "react"

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

        <Button size="small" color="primary:base" type="submit" disabled={snapshot.isResponding}>
            {snapshot.isResponding ? "Sending…" : request.submit ?? "Submit"}
        </Button>
    </form>
}

function PromptFieldView({ field, value, disabled, change }: Readonly<{
    field: PromptField
    value: PromptValue | undefined
    disabled: boolean
    change(value: PromptValue | undefined): void
}>) {

    const identity = useId()
    const descriptionId = `${identity}-description`
    const shared = { label: field.label, description: field.description, disabled, required: field.required }

    if (field.type === "boolean" || field.type === "confirmation") {
        return <Checkbox {...shared}
            required={field.type === "confirmation" && field.required}
            checked={value === true}
            onChange={change}
        />
    }

    if (field.type === "textarea") {
        return <Textarea {...shared} rows={4} value={typeof value === "string" ? value : ""}
            placeholder={field.placeholder} onChange={change} />
    }

    if (field.type === "select") {
        return <Select {...shared} value={typeof value === "string" ? value : null}
            placeholder="Select…" options={field.options}
            onChange={value => change(value || undefined)} />
    }

    if (field.type === "text") {
        return <Input {...shared} value={typeof value === "string" ? value : ""}
            placeholder={field.placeholder} onChange={value => change(value || undefined)} />
    }

    // React UI has no NumberField, DateField or multi-select yet. Keep native
    // input semantics and validation, with Surface owning their material.
    return <div className="native-field">
        <label htmlFor={identity}>{field.label}</label>
        {field.description && <small id={descriptionId}>{field.description}</small>}
        <Surface className="native-field-surface">
            {field.type === "multi-select" ? <select
                id={identity}
                aria-describedby={field.description ? descriptionId : undefined}
                multiple
                value={Array.isArray(value) ? value.filter(item => typeof item === "string") : []}
                required={field.required}
                disabled={disabled}
                onChange={event => change([...event.target.selectedOptions].map(option => option.value))}
            >
                {field.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select> : field.type === "number" ? <input
                id={identity}
                aria-describedby={field.description ? descriptionId : undefined}
                type="number"
                value={typeof value === "number" ? value : ""}
                min={field.minimum}
                max={field.maximum}
                step={field.step}
                required={field.required}
                disabled={disabled}
                onChange={event => change(event.target.value === "" ? undefined : event.target.valueAsNumber)}
            /> : <input
                id={identity}
                aria-describedby={field.description ? descriptionId : undefined}
                type="date"
                value={typeof value === "string" ? value : ""}
                required={field.required}
                disabled={disabled}
                onChange={event => change(event.target.value || undefined)}
            />}
        </Surface>
    </div>
}

function initialValues(fields: readonly PromptField[]): Values {

    return Object.fromEntries(fields.map(field => [
        field.key,
        field.value ?? (field.type === "boolean" || field.type === "confirmation" ? false : undefined)
    ]))
}
