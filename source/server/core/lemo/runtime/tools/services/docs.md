# services

Connects Lemo to a Service only through documentation read from the authoritative
Program Endpoint. Services are not a separate registry and this tool does not
list them.

## Required flow

1. Use `programs.docs` for the exact Program Endpoint.
2. Read its Service name, policies, events, and payload contracts.
3. Connect using the returned contract identity and documented name:

```json
{
  "action": "connect",
  "contract": "endpoint-contract:...",
  "name": "browser"
}
```

The result contains a durable `service` handle. Use that handle for every later
operation. A contract belongs to the current Task and becomes invalid if the
installed documentation changes.

## Status and readiness

```json
{ "action": "status", "service": "service:..." }
```

Use `waitReady` with the same handle. `timeout` is an optional positive number
of milliseconds; omission uses the SDK default.

## Create the providing Endpoint

Use `createAndWaitReady` when the Service is not already available. The System
creates or finds the Service's dedicated Process, starts only its providing
Endpoint, and waits for the exact Service. Lemo must not reproduce that launch
through the `processes` tool.

```json
{
  "action": "createAndWaitReady",
  "service": "service:..."
}
```

For a Client Service only, optional `client` overrides may set its initial
title, size, position, layer, location, or minimized state. `timeout` covers
the complete creation and readiness operation.

## Ask a Server Service

```json
{
  "action": "ask",
  "service": "service:...",
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
