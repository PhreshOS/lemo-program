# endpoints

Reads and controls one Server or Client Endpoint belonging to a live PhreshOS
Process.

Every operation requires a Process identity and an Endpoint kind. When a
Program identity is supplied, the Process value may instead be that Program's
local Process name.

## Inspect

```json
{
  "action": "inspect",
  "process": "process-identity",
  "endpoint": "server"
}
```

Returns whether the Endpoint is declared and currently running.

## Start and Stop

Use `start` or `stop` with the same Process and Endpoint coordinates. The SDK's
authoritative lifecycle rules are preserved. Starting an undeclared or already
live Endpoint fails. Stopping an absent Endpoint or the final live Endpoint of
a Process fails. Successful changes are recorded in Memory.

## Wait for Server Readiness

Use `waitReady` for a Server Endpoint. `timeout` is an optional positive number
of milliseconds; omission uses the SDK default. Readiness waiting does not
write Memory.

## Ask a Server Endpoint

Use `ask` when the Program's agent documentation defines a request-response
event on its Server Endpoint:

```json
{
  "action": "ask",
  "process": "process-identity",
  "endpoint": "server",
  "event": "workspace.create",
  "payload": { "client": true }
}
```

The optional positive `timeout` controls the complete readiness and answer
deadline. Payloads pass through unchanged and must follow the Program's agent
documentation exactly.

## Publish to an Endpoint

Use `publish` for a destination that accepts an event without returning an
answer. Server and Client Endpoints are both supported, but the destination must
already be running.

```json
{
  "action": "publish",
  "process": "process-identity",
  "endpoint": "client",
  "event": "refresh",
  "payload": null
}
```

Read the Program's agent documentation before using Program-specific events.
