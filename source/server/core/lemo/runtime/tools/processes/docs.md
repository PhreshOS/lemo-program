# processes

Discovers and controls live executions of PhreshOS Programs.

Use `list` for a bounded page ordered from newest to oldest. Restrict it to a
Program when needed; `limit` defaults to 30 and `offset` continues through
later results. Use `inspect` to read one Process and the state of both Endpoint
addresses.

Before `create`, `findOrCreate`, or `exit`, inspect the Program and read its
agent contract when one exists. A Process can contain a Server Endpoint, a
Client Endpoint, or both. Use explicit `server` and `client` selections when
the topology matters. Omitted selections inherit the Program declaration.

`launch.options` contains this Process's string values, readable by both
Endpoints, and defaults to `{}`. A Client launch may set `service`, `title`,
`position`, `size`, `layer`, `minimize`, and `maximize`:

```json
{"action":"create","program":"program-identity","launch":{"client":{"maximize":true},"options":{"document":"notes.txt"}}}
```

These operations use the supplied Launch and declaration defaults. To open
using a saved icon launch, obtain it with `programs.getLaunch` and pass it
explicitly. Each Endpoint's `declared`, `running`, and `service` values in the
result describe that Endpoint; they are not Process lifecycle states.

`findOrCreate` requires a stable Program-local Process name. If an existing
Process with that name has a different resolved launch, the operation fails;
it is never silently reshaped.

For `create` or `findOrCreate`, `launch: { name: "main", replace: true }`
ends the existing Process named `main` within the selected Program before
creating its replacement. Processes belonging to other Programs are unaffected.

Use `wait` at System, Program, or Process scope. System and Program scopes can
observe `create` and `exit`; an individual Process can observe only `exit`.
`process` is a global identity, or a Program-local name with `program` supplied.
Waits observe future events, with a default `timeout` of 10,000 milliseconds.
Start a wait before the operation that should produce the event.
