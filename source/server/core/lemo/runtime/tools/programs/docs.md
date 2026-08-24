# programs

Reads the authoritative PhreshOS Program registry.

## List Programs

Use `{ "action": "list" }` to list installed Programs. Set `installedOnly` to
`false` when runtime Programs without an installed form are also relevant.
Listings contain compact identity, metadata, and Endpoint declaration facts.

## Inspect a Program

Use `{ "action": "inspect", "program": "identity" }` for one Program. The
result also includes the Client Endpoint's declared Window defaults.

## Read Endpoint Service Documentation

Use `{ "action": "docs", "program": "identity", "endpoint": "server" }` or
select `client`. Documentation is available before the Endpoint or its Service
starts. It defines the Service name, policies, and API contract. The result also
contains a Task-bound `contract` identity for that exact documentation. Pass it
to `services.connect`; do not invent Service events or coordinates independently.

Unknown Programs, missing Endpoints, and Endpoints without declared Service
documentation are errors. This tool is read-only and does not record registry
snapshots into Memory.
