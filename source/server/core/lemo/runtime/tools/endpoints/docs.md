# endpoints

Inspects, controls, and communicates with the Server and Client Endpoints of a
live Process.

Use `inspect` to read whether an Endpoint is declared, running, and exposed as
a Service. Use `start` and `stop` for one Endpoint incarnation. The final live
Endpoint cannot be stopped; exit the Process instead. `waitReady` applies to a
Server Endpoint and waits for both existence and its readiness announcement.
Use `waitLifecycle` for the next `start` or `stop` transition at an exact
Endpoint address.

`process` is a global identity, or a Program-local name when `program` is given.
Server `start` accepts `launch.service`. Client `start` accepts `service`,
`title`, `position`, `size`, `layer`, `minimize`, and `maximize`. Omitted values
use the Endpoint launch defaults; Process options belong to Process creation.

Use `ask` to send an event to a Server Endpoint and await its answer. Use
`publish` to send an event to either Endpoint without awaiting an answer. Use
`wait` for the next destinationless publication emitted by a live Endpoint.

Inspect the owning Program and read its agent contract before using
Program-specific events. That contract defines event names, payloads, answers,
publications, and operating policy. Tool payloads are JSON values and pass
through unchanged. The underlying Endpoint contract also supports binary data,
but this tool's JSON input does not construct binary values. An
acknowledgement does not imply any state beyond what the Program contract says.

`wait` and `waitLifecycle` observe future events. Start a wait before the
triggering operation; both default to 10,000 milliseconds and release their
subscription when the Task stops. `timeout` values are milliseconds.
