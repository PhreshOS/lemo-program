# tools

Discovers Runtime tools. Pass `names` to load particular tools or `all: true`
to load every available ordinary tool. The selected tools become available on
the next Model cycle.

Every returned Tool definition derives from Runtime's approval template. Add
`"approval": true` directly beside the Tool's ordinary input properties to ask
the user before that same invocation executes. Approval is not another Tool
call. Never pass another Tool's input to this discovery Tool. Individual Tools
may also make approval mandatory for particular inputs.
