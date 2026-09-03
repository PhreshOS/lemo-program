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

`findOrCreate` requires a stable Program-local Process name. If an existing
Process with that name has a different resolved launch, the operation fails;
it is never silently reshaped.

Use `wait` at System, Program, or Process scope. System and Program scopes can
observe `create` and `exit`; an individual Process can observe only `exit`.
