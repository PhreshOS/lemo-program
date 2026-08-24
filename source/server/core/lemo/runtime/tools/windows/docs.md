# windows

Reads and controls the authoritative Window owned by a live PhreshOS Client
Endpoint. This tool has no listing operation; discover Processes with the
`processes` tool.

Every operation requires a Process identity. When a Program identity is also
supplied, the Process value may instead be that Program's local Process name.

## Inspect

Use `{ "action": "inspect", "process": "identity" }` to read the complete
authoritative Window state: title, position, size, minimized state, frontmost
state, layer, and current Client location.

## Change Window State

The available mutations match the Window contract directly:

- `move` with a complete `position`.
- `resize` with a complete `size`.
- `setGeometry` with both `position` and `size` in one atomic operation.
- `minimize` with an optional boolean; omission minimizes the Window.
- `changeTitle` with the complete new title.
- `raise` to bring the Window to the front of its current layer.

Every numeric geometry value is an absolute pixel count. A decimal does not
represent a share: `0.5` means half a pixel and `1` means one pixel. Use a
string containing a percentage or fraction for workspace-relative geometry.
Plain numeric strings are also pixels.

For example, place a Window over the complete left half of its workspace with:

```json
{
  "action": "setGeometry",
  "process": "process-identity",
  "position": { "x": 0, "y": 0 },
  "size": { "width": "50%", "height": "100%" }
}
```

Equivalent fractional expressions include `"1/2"` and `"1/1"`. Linear pixel
offsets may be combined with them, such as `"50% - 8"`. The Program must
declare a Client Endpoint and that Client must be running.

Window state is transient authoritative system state, so this tool does not
copy reads or mutations into Memory. Server code cannot access local Surface
presentation; that remains a Client-only capability.

## Wait for Window Events

Use `wait` to receive the next authoritative `move`, `resize`, `geometry`,
`minimize`, `changeTitle`, or `front` event from one Window:

```json
{
  "action": "wait",
  "process": "process-identity",
  "event": "resize",
  "timeout": 30000
}
```

The result contains the Process identity, event name, and complete event
payload. The timeout defaults to 10 seconds. Task pause or cancellation
immediately releases the temporary subscription.
