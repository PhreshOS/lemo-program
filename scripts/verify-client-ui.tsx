import assert from "node:assert/strict"
import { renderToStaticMarkup } from "react-dom/server"
import { standardAppearance } from "@phreshos/core"
import { AppearanceProvider, Select } from "@phreshos/react-ui"
import Tool from "../source/client/core/lemo/tool"
import PromptForm from "../source/client/view/tools/prompt/form"
import type { PromptRequest } from "../source/server/core/lemo/runtime/tools/prompt/contract"

const request = {
    type: "form",
    fields: [
        { type: "text", key: "name", label: "Name", value: "Example", required: true },
        { type: "textarea", key: "notes", label: "Notes", value: "Two\nlines" },
        { type: "number", key: "count", label: "Count", minimum: 2, maximum: 12, step: 2, value: 4 },
        { type: "date", key: "day", label: "Day", value: "2026-09-10" },
        { type: "boolean", key: "enabled", label: "Enabled", value: true },
        { type: "confirmation", key: "confirm", label: "Confirm", required: true },
        { type: "select", key: "one", label: "One", value: "b", options: [{ value: "a", label: "Alpha" }, { value: "b", label: "Beta" }] },
        { type: "multi-select", key: "many", label: "Many", value: ["a", "b"], options: [{ value: "a", label: "Alpha" }, { value: "b", label: "Beta" }] }
    ]
} satisfies Extract<PromptRequest, { type: "form" }>

const tool = new Tool("task", "call", "prompt", request, { async respond() {} })

for (const theme of ["light", "dark"] as const) {
    for (const isResponding of [false, true]) {
        const form = <PromptForm tool={tool} request={request}
            snapshot={{ ...tool.snapshot(), isResponding }} report={assert.fail} />
        const html = renderToStaticMarkup(<AppearanceProvider appearance={standardAppearance} theme={theme}>
            {form}{form}
        </AppearanceProvider>)

        // Check rendered native semantics, not source-code spelling or CSS classes.
        const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1])
        assert.equal(new Set(ids).size, ids.length, "Simultaneous prompts must have distinct control IDs")
        const number = html.match(/<input\b[^>]*type="number"[^>]*>/)?.[0]
        assert.ok(number)
        for (const attribute of ['min="2"', 'max="12"', 'step="2"', 'value="4"']) {
            assert.ok(number.includes(attribute), `Number field retains ${attribute}`)
        }
        assert.match(html, /<input\b[^>]*type="date"[^>]*value="2026-09-10"/)
        assert.match(html, /<textarea\b[^>]*>Two\nlines<\/textarea>/)
        const multiple = html.match(/<select\b[^>]*multiple=""[^>]*>[\s\S]*?<\/select>/)?.[0]
        assert.ok(multiple)
        assert.match(multiple, /<option value="a" selected="">Alpha<\/option>/)
        assert.match(multiple, /<option value="b" selected="">Beta<\/option>/)
        assert.equal(number.includes('disabled=""'), isResponding)
        assert.equal(multiple.includes('disabled=""'), isResponding)
        for (const field of request.fields) assert.ok(html.includes(field.label))
        assert.ok(html.includes(isResponding ? "Sending…" : "Submit"))
    }
}

const reasoning = renderToStaticMarkup(<AppearanceProvider appearance={standardAppearance} theme="light">
    <Select aria-label="Reasoning level" value="" options={[
        { value: "", label: "Default reasoning" },
        { value: "high", label: "High" }
    ]} />
</AppearanceProvider>)
assert.ok(reasoning.includes("Default reasoning"), "Empty-string default reasoning remains a selectable value")

console.log("Client UI rendering verified: prompt fields, constraints, selection, disabled states, unique IDs, and reasoning default")
