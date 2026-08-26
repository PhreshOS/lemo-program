# processes

Discovers and controls live PhreshOS Processes. A Process may contain a Server
Endpoint, a Client Endpoint, or both. The owning Program defines which topology
is valid.

## Required preparation

Before `create`, `findOrCreate`, or `exit`:

1. inspect the Program with `programs`;
2. when `hasAgent` is true, read its agent document;
3. use the exact topology, name, options, and cleanup policy it defines.

Do not infer Program policy from the user's goal or from this generic Tool.

## Launch semantics

`launch.server` and `launch.client` are optional because omission means **use
the Program's declared default**. Omission does not mean `false`.

- Use `server: true` or `server: false` to select explicitly.
- Use `client: true`, `client: false`, or a Client Window object.
- A Client Window object selects the Client and overrides only the supplied
  Window properties.
- To create a Server-only Process, always pass both `server: true` and
  `client: false`.
- To create a Client-only Process, always pass both `server: false` and a
  Client selection.

Server-only example:

```json
{
  "action": "create",
  "program": "program-identity",
  "launch": {
    "name": "shared-server",
    "server": true,
    "client": false
  }
}
```

Client-only example:

```json
{
  "action": "create",
  "program": "program-identity",
  "launch": {
    "name": "visible-client",
    "server": false,
    "client": {
      "title": "Program",
      "size": { "width": "50%", "height": "100%" }
    }
  }
}
```

`options` contains immutable string values available to the new Process.
Geometry numbers are pixels; use strings such as `"50%"` or `"1/2"` for
workspace-relative values.

## Actions

### `list`

Lists live Processes. Omit `program` for the Host-wide list, or provide a
Program identity to scope it:

```json
{ "action": "list", "program": "terminal" }
```

### `inspect`

Reads one live Process. `process` is normally its identity. When `program` is
also supplied, `process` may be that Program's local Process name.

### `create`

Creates a new Process from the supplied launch. If `launch` is omitted, every
Endpoint selection comes from the Program defaults. Use explicit selections
whenever the required topology matters.

### `findOrCreate`

Requires a named launch. Equivalent concurrent requests resolve the same
Process. If that name already belongs to a Process with a different resolved
launch, the operation fails; it does not silently reuse or reshape it.

### `exit`

Ends the complete Process and all of its live Endpoints. Read Program cleanup
policy first.

### `wait`

Waits for one `endpointStart`, `endpointStop`, `create`, or `exit` event.
Without coordinates it observes the Host registry. With only `program`, it
observes that Program. With `process`, it observes one Process; an individual
Process does not emit `create`.

```json
{ "action": "wait", "event": "create", "program": "terminal", "timeout": 30000 }
```

The timeout defaults to 10 seconds. Pausing or cancelling the Task releases the
wait immediately.

## Memory behavior

Listing and inspection are not copied into Memory. Successful creation,
resolution, and exit record concise Process facts. Starting or stopping an
individual Endpoint belongs to `endpoints`.
