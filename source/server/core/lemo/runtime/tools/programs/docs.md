# programs

Reads the authoritative PhreshOS Program registry.

## List Programs

Use `{ "action": "list" }` to list installed Programs. Set `installedOnly` to
`false` when runtime Programs without an installed form are also relevant.
Listings contain compact identity, metadata, and Endpoint declaration facts.

## Inspect a Program

Use `{ "action": "inspect", "program": "identity" }` for one Program. The
result also includes the Client Endpoint's declared Window defaults.

## Read Agent Documentation

Every listing and inspection includes `hasAgent`. When it is `true`, use
`{ "action": "agent", "program": "identity" }` to read the Program's operating
knowledge before loading or using operational tools for that Program. Read it
before choosing a Process launch, Endpoint event, payload, lifecycle, or
cleanup. Do not perform an operation first and consult the document afterward.

Agent documentation contains only knowledge controlled by that Program: its
operating modes, policies, Endpoint responsibilities, event names, payloads,
results, and cleanup requirements. Generic Process and Endpoint mechanics are
defined by their own tools, not by Program documentation.

Unknown Programs and Programs without agent documentation are errors. This tool
is read-only and does not record registry snapshots into Memory.
