# windows

Inspects and controls the authoritative Window of one live Client Endpoint.

A Window is discovered through its Process; there is no Window list operation.
The Process must declare and run a Client Endpoint.

Use `move`, `resize`, or `setGeometry`; the last operation changes position and
size atomically. Geometry numbers are absolute pixels. Strings can be
workspace-relative expressions such as `50%`, `1/2`, or `50% - 8`:

```json
{"action":"resize","process":"process-identity","size":{"width":"50%","height":"100%"}}
```

Use `minimize` for visibility, `changeTitle` for the human-readable title, and
`raise` to move the Window to the front of its current layer without changing
focus.

Use `wait` for one authoritative Window change. Local Surface presentation is
not part of this tool.
