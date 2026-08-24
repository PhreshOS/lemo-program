# processes

Reads and controls live PhreshOS Processes.

Process launch is Program-owned policy. Before `create`, `findOrCreate`, or
`exit`, inspect the Program with `programs`. When it reports `hasAgent: true`,
read the Program's agent documentation first and derive the launch and cleanup
from it. Never guess whether Server and Client should run together, what a
shared Process is named, or who owns its lifecycle.

## List

Use `{ "action": "list" }` for every live Process visible to the Server. Add a
Program identity to list only that Program's Processes:

```json
{ "action": "list", "program": "flambo" }
```

## Inspect

Use `{ "action": "inspect", "process": "process-identity" }`. When `program`
is supplied, `process` may instead be that Program's local Process name.

## Create

Use `{ "action": "create", "program": "identity", "launch": {} }`. The
optional `launch` value follows the complete PhreshOS Process launch contract:
it can select Server and Client Endpoints, configure the Client Window, assign
a Program-local name, and provide immutable string options.

## Find or Create

Use `findOrCreate` with a required named launch. Equivalent concurrent requests
resolve the same Process. A conflicting launch for an existing name is an
error.

## Exit

Use `{ "action": "exit", "process": "process-identity" }` to end a complete
Process and all of its live Endpoints.

Listing and inspection do not write Memory. Successful creation, shared
Process resolution, and exit are deliberately recorded with their Program and
Process identities. Starting and stopping individual Endpoints belongs to the
separate `endpoints` capability.

## Wait for Process Events

Use `wait` to receive one `endpointStart`, `endpointStop`, `create`, or `exit`
event. Without coordinates it observes the Host Process registry:

```json
{ "action": "wait", "event": "create", "timeout": 30000 }
```

Supply only `program` to observe that Program's Process registry. Supply
`process`, with optional `program` for local-name resolution, to observe one
Process; an individual Process emits every listed event except `create`.
Results identify their scope and contain a JSON-safe Process, Endpoint, or exit
payload. The timeout defaults to 10 seconds, and pausing or cancelling the Task
releases the temporary subscription immediately.
