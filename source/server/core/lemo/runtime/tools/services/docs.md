# services

Operates on one exact PhreshOS Service address. Services are Endpoint
capabilities, not a separate registry, and this tool does not list them.

## Required flow

1. Use `programs.docs` for the exact Program Endpoint.
2. Read its Service name, policies, events, and payload contracts.
3. Reuse this exact address for every Service operation:

```json
{
  "program": "flambo",
  "endpoint": "server",
  "name": "browser"
}
```

Do not invent Service names, events, or payloads. The tool validates the Program,
Endpoint, and installed Service documentation before every operation.

## Status and readiness

```json
{
  "action": "status",
  "service": { "program": "flambo", "endpoint": "server", "name": "browser" }
}
```

Use `waitReady` with the same Service address. `timeout` is an optional positive
number of milliseconds; omission uses the SDK default.

## Create the providing Endpoint

Use `createAndWaitReady` when the Service is not already available. The System
creates or finds the Service's dedicated Process, starts only its providing
Endpoint, and waits for that exact Service. Do not reproduce this launch through
the `processes` tool.

```json
{
  "action": "createAndWaitReady",
  "service": { "program": "flambo", "endpoint": "server", "name": "browser" }
}
```

For a Client Service only, optional `client` overrides may set its initial
title, size, position, layer, location, or minimized state. `timeout` covers the
complete creation and readiness operation.

## Ask a Server Service

```json
{
  "action": "ask",
  "service": { "program": "flambo", "endpoint": "server", "name": "browser" },
  "event": "workspace.create",
  "payload": { "client": true }
}
```

Only a Server Service can be asked. Follow the Endpoint documentation exactly.
The payload accepts any JSON value and passes through unchanged. An optional
positive `timeout` sets the answer deadline.

Raw answers remain in the Task database. Large binary fields and oversized
answers are reduced only when rebuilding text Model context, preventing images
or frames from consuming later cycles. This generic bridge never promotes a
Service result into Memory.
