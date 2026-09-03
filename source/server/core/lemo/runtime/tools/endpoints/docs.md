# endpoints

Inspects, controls, and communicates with the Server and Client Endpoints of a
live Process.

Use `inspect` to read whether an Endpoint is declared, running, and exposed as
a Service. Use `start` and `stop` for one Endpoint incarnation. The final live
Endpoint cannot be stopped; exit the Process instead. `waitReady` applies to a
Server Endpoint and waits for both existence and its readiness announcement.
Use `waitLifecycle` for the next `start` or `stop` transition at an exact
Endpoint address.

Use `ask` to send an event to a Server Endpoint and await its answer. Use
`publish` to send an event to either Endpoint without awaiting an answer. Use
`wait` for the next destinationless publication emitted by a live Endpoint.

Inspect the owning Program and read its agent contract before using
Program-specific events. That contract defines event names, payloads, answers,
publications, and operating policy. Payloads pass through unchanged, and an
acknowledgement does not imply any state beyond what the Program contract says.
