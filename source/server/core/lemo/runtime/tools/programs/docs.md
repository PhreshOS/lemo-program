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

Use `wait` for one Program registry event. A wait on the complete registry can
observe `create`, `forget`, `install`, or `uninstall`. A wait scoped to one
Program can observe only `forget` or `uninstall`, because those are the events
emitted by an existing Program handle.

An omitted Endpoint selection in a Process launch may inherit the Program
declaration. Omission does not mean `false`.
