# windows

Inspects and controls the authoritative Window of one live Client Endpoint.

A Window is discovered through its Process; there is no Window list operation.
The owning Program must declare a Client Endpoint and the Process must have it
running. `process` is a global identity, or a Program-local name when `program`
is supplied. Use `processes.list` to discover it.

`inspect` returns title, position, size, minimized, maximized, front, and layer.
These are authoritative values; a Client's local representation may follow or
unfollow them. The tool cannot read or control that local copy.

Use `move`, `resize`, or `setGeometry`; the last operation changes position and
size atomically. Geometry numbers are absolute pixels. Strings can be
workspace-relative expressions such as `50%`, `1/2`, or `50% - 8`:

```json
{"action":"resize","process":"process-identity","size":{"width":"50%","height":"100%"}}
```

Use `minimize` with `minimized` and `maximize` with `maximized`. Both default to
`true`; send `false` to restore the corresponding state:

```json
{"action":"maximize","process":"process-identity","maximized":false}
```

Presentation follows `minimized > maximized > geometry`: minimized hides the
Window, maximized fills the workspace, otherwise stored position and size apply.
Both booleans can be true. Unminimizing a maximized Window keeps it maximized.
Move and resize still update stored geometry in either state; they do not clear
the booleans. To show a particular rectangle, clear both and use `setGeometry`.

Use `changeTitle` for the title and `raise` to bring the Window to the front of
its layer. Raising does not clear minimized or maximized state. These operations
apply across `window`, `under`, and `over`; the Client decides whether its local
representation follows the authoritative Window. Desktop presentation owns the
animation, so a returned state is not proof that an animation has finished.

Use `wait` for the next `move`, `resize`, `geometry`, `minimize`, `maximize`,
`changeTitle`, or `front` event. It observes future changes, not existing state.
Start waiting before the triggering operation. `timeout` is milliseconds and
defaults to 10,000; cancellation releases the subscription.
