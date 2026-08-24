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

Returns whether the Endpoint is declared, currently running, and currently
providing a Service. Service identity and usage remain defined by the owning
Program's Endpoint documentation.

## Start and Stop

Use `start` or `stop` with the same Process and Endpoint coordinates. The SDK's
authoritative lifecycle rules are preserved. Starting an undeclared or already
live Endpoint fails. Stopping an absent Endpoint or the final live Endpoint of
a Process fails. Successful changes are recorded in Memory.

## Wait for Server Readiness

Use `waitReady` for a Server Endpoint. `timeout` is an optional positive number
of milliseconds; omission uses the SDK default. Readiness waiting does not
write Memory.

Service communication is owned by the separate `services` tool.

