# tasks

Accesses Lemo's durable Tasks. This is an ordinary Runtime tool and receives
the same complete invocation context as every other tool.

Use `list` to search a bounded page of Task summaries. `limit` defaults to 20
and cannot exceed 100. Continue from `next` by passing it as `cursor`. Filter by
status, creating Task, creation time, or input text. A list never returns Task
operation histories.

Use `read` with a Task identity to reconstruct a token-bounded XML event history.
It identifies the Task, its objective and execution metadata, then presents its
meaningful assistant, Tool, Memory, and failure events in chronological order.
`tokens` defaults to 8,000 estimated tokens and cannot exceed 16,000. Pass the
returned `before` cursor to continue toward older events.

Every truncated block identifies its durable operation and says
`retrieve="tasks.read_block"`. Use `read_block` with the Task and operation
identities to read the complete raw operation in bounded token pages. Continue
from `next` as `offset` until it is `null`.

Use `create` with `input` to start an independent concurrent Task. It inherits
this Task's LLM Model and records this invocation as its source. Lemo allows at
most 10 running or paused Tasks in total; completed, failed, and cancelled
Tasks do not consume execution capacity.

Use `send` with a receiving `task` identity, an application-defined `event`,
and a `message` to communicate explicitly with another running Task. The
message records this Task and Tool call as its source. Every message remains
durable; the receiver's next Model cycle includes only its 10 newest messages
in the dedicated `inbox` section.
Messages already included in an earlier cycle carry their original delivery
timestamp so the receiver can distinguish them from newly received messages.

Use `pause`, `continue`, or `cancel` with a Task identity. A running Task cannot
pause or cancel itself from inside its own active tool invocation.

Use `wait` to wait for the next matching Task event. Optionally restrict it by
Task identities or event names and provide a timeout in milliseconds. Without
filters it waits for the next event from any Task. Waiting is cancelled when
the invoking Task stops.

Use `wait_message` with an event to wait for the next message directed to this
Task with that exact event. This is ordinary Tool execution and is cancelled
when the invoking Task stops.
