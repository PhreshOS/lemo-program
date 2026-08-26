# tools

Discovers and loads Runtime Tool definitions. It does not execute the selected
Tools.

Pass exact Tool names when the required capabilities are known:

```json
{ "names": ["programs", "processes"] }
```

Use `{ "all": true }` only when broad discovery is genuinely necessary. The
selected definitions become available on the next Model cycle. Read an
unfamiliar Tool's documentation with `docs` before its first high-impact or
state-changing invocation.

Every returned Tool definition derives from Runtime's approval template. Add
`"approval": true` directly beside the Tool's ordinary input properties to ask
the user before that same invocation executes. Approval is not another Tool
call. Never pass another Tool's input to this discovery Tool. Individual Tools
may also make approval mandatory for particular inputs.
