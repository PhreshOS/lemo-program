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

Positions and sizes accept either absolute numbers or PhreshOS relative linear
expressions. The Program must declare a Client Endpoint and that Client must be
running.

Window state is transient authoritative system state, so this tool does not
copy reads or mutations into Memory. Server code cannot access local Surface
presentation; that remains a Client-only capability.

