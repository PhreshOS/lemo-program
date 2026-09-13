# programs

Discovers PhreshOS Programs and reads the operating contract published by each
Program for agents.

Use `list` for a bounded page of Programs. Results are ordered by identity;
`installedOnly` defaults to `true`, `limit` defaults to 30, and `offset`
continues through later results.

Use `inspect` before operating a Program. When `hasAgent` is true, use `agent`
to read that Program's own launches, events, payloads, results, and cleanup
rules. Those rules belong to the Program; generic Process and Endpoint
mechanics remain part of PhreshOS.

Inspection includes the resolved Server and Client declarations: `start` and
`service` defaults, plus the Client's title, size, position, layer, minimize,
and maximize defaults. These describe launch defaults, not live Endpoint or
Window state. Use `endpoints` and `windows` for live state.

Use `getLaunch` to read the saved icon launch (`null` when none is stored), and
`setLaunch` to replace it with a Launch:

```json
{"action":"setLaunch","program":"program-identity","launch":{"client":{"maximize":true}}}
```

This saves configuration; it does not start a Process. The Desktop reads it
when opening a Program icon. To use it through the tools, read it and explicitly
pass it to `processes.create` (`{}` when the stored value is `null`). A saved icon
launch is independent of startup and declaration fallback values. `setLaunch`
accepts an object; `{}` selects declaration defaults when that launch is used.

Use `wait` for one Program registry event. A wait on the complete registry can
observe `create`, `forget`, `install`, or `uninstall`. A wait scoped to one
Program can observe only `forget` or `uninstall`, because those are the events
emitted by an existing Program handle.

Waits observe future events. Start the wait before the operation that should
produce the event. `timeout` is milliseconds and defaults to 10,000.

An omitted Endpoint selection in a Process launch may inherit the Program
declaration. Omission does not mean `false`.
