# tasks

Accesses Lemo's durable Tasks. This is an ordinary Runtime tool and receives
the same complete invocation context as every other tool.

Use `list` to search a bounded page of Task summaries. `limit` defaults to 20
and cannot exceed 100. Continue from `next` by passing it as `cursor`. Filter by
status, creating Task, creation time, or input text. A list never returns Task
operation histories.

Use `read` with a Task identity to read a bounded page of its most recent
operations. Pass the returned operation cursor as `before` to continue toward
older history.

Use `create` with `input` to start an independent concurrent Task. It inherits
this Task's LLM Model and records this invocation as its source. Lemo allows at
most 10 running or paused Tasks in total; completed, failed, and cancelled
Tasks do not consume execution capacity.

Use `send` with a receiving `task` identity and `message` to communicate
explicitly with another running Task. The message records this Task and Tool
call as its source. Every message remains durable; the receiver's next Model
cycle includes only its 10 newest messages in a dedicated Messages section.
Messages already included in an earlier cycle carry their original delivery
timestamp so the receiver can distinguish them from newly received messages.

Use `pause`, `continue`, or `cancel` with a Task identity. A running Task cannot
pause or cancel itself from inside its own active tool invocation.

Use `wait` to wait for the next matching Task event. Optionally restrict it by
Task identities or event names and provide a timeout in milliseconds. Without
filters it waits for the next event from any Task. Waiting is cancelled when
the invoking Task stops.
