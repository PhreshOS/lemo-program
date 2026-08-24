# prompt

Presents one temporary interaction inside the Task that called this tool and
waits for the first Client result. Runtime owns correlation, capacity, timeout,
restoration after Client reload, and release.

## Structured forms

Use `type: "form"` for ordinary input. It is the preferred form when the
interaction can be described using fields. Every field requires a unique `key`,
a `label`, and one of these types:

- `text` or `textarea`: optional `placeholder` and string `value`;
- `number`: optional `minimum`, `maximum`, positive `step`, and numeric `value`;
- `boolean`: optional boolean `value`;
- `select`: `options` containing `{ value, label }` and an optional string `value`;
- `multi-select`: `options` and an optional string-array `value`;
- `date`: optional `YYYY-MM-DD` string `value`;
- `confirmation`: a checkbox whose required state must be accepted.

Every field may include `description` and `required`. The form may include
`title`, explanatory `content`, and a custom `submit` label.

```json
{
  "type": "form",
  "title": "Create the workspace",
  "content": "Choose its initial properties.",
  "submit": "Create",
  "fields": [
    { "type": "text", "key": "name", "label": "Name", "required": true },
    {
      "type": "select",
      "key": "visibility",
      "label": "Visibility",
      "options": [
        { "value": "private", "label": "Private" },
        { "value": "public", "label": "Public" }
      ]
    }
  ]
}
```

## Interactive HTML

Use `type: "html"` only when the structured fields cannot express the required
interaction. The document runs inside a sandboxed iframe. A small frozen SDK is
injected before the supplied scripts execute:

```js
form.set("result-key", jsonCompatibleValue)
form.submit()
```

`form.set()` replaces one value in the pending result. Values must be bounded,
JSON-compatible data. `form.submit()` submits an immutable snapshot once. The
iframe allows scripts and HTML forms, but it has an opaque origin and cannot
reach Lemo, Runtime, Client Core, the parent document, or PhreshOS APIs. Use
`event.preventDefault()` when an HTML form should submit through this SDK rather
than navigate inside the iframe.

```json
{
  "type": "html",
  "title": "Arrange the cards",
  "html": "<button onclick=\"form.set('choice', 'first'); form.submit()\">First</button>"
}
```

An uncaught document error, unhandled rejection, invalid SDK value, oversized
result, or protocol violation fails the tool call. The Cancel control belongs
to Lemo outside the iframe, so it remains available if the document breaks.

## Result

Submission returns:

```json
{ "type": "submitted", "values": { "name": "Example" } }
```

User cancellation returns:

```json
{ "type": "cancelled" }
```

The call fails when the bounded queue is full, the timeout expires, the Task is
interrupted, or the interactive document fails technically.
