# services

Connects Lemo to one exact documented PhreshOS Endpoint Service. Services are
not a separate registry and this tool does not list them. Discover a Program's
Service capability and read its name, policies, events, and payload contracts
through the `programs` tool first.

Every operation uses the complete Service coordinates: Program identity,
Endpoint kind, and Program-authored Service name.

## Status

```json
{
  "action": "status",
  "program": "flambo",
  "endpoint": "server",
  "name": "browser"
}
```

Returns whether that exact Service is currently enabled.

## Wait Until Ready

Use `waitReady` with the same coordinates. `timeout` is an optional positive
number of milliseconds; omission uses the SDK default.

## Ask a Server Service

Only a Server Service can be asked a question:

```json
{
  "action": "ask",
  "program": "flambo",
  "endpoint": "server",
  "name": "browser",
  "event": "workspace.create",
  "payload": {}
}
```

The payload and answer pass through unchanged. An optional positive `timeout`
selects one deadline shared by Service readiness and the answer.

This generic bridge cannot understand the domain meaning of a Service answer,
so it never promotes results into Memory. The Task's raw operation history
still preserves each tool call and result.

