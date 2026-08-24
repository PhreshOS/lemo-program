# memory

Recalls durable context from Lemo's shared history. Pass the current subject as
`query`. The optional `budget` is a character budget from 1,000 through 32,000;
the default is 32,000.

Half of the budget preserves the latest statement and original input of recent
Tasks. This prevents one cycle-heavy Task from consuming all recent context.
The other half favors history that is both lexically related to the query and
temporally close. Selection ranks relevant facts as anchors, then adds their
Task input, nearby facts, and any correlated failed Tool request as disposable
context. Candidates that do not fit are skipped, small facts do not consume the
same share as large facts, and overlapping context is deduplicated.

The result identifies whether each operation was a recent anchor, relevant
anchor, or supporting context, together with its original Task, operation,
parent, global sequence, kind, source, recording method, tool, call, and
creation time.

Failed Tasks and failed Tool results are eligible evidence. Successful Tool
outputs remain excluded unless their owning Tool deliberately records a durable
fact through its Memory context.
