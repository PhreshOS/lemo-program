# memory

Recalls durable context from Lemo's shared history. Pass the current subject as
`query`. The optional `budget` is a character budget from 1,000 through 32,000;
the default is 32,000.

Memory treats the query as its working focus. It favors distinctive matching
terms using their rarity across Memory, adds temporal proximity instead of
multiplying by it, and expands strong anchors into coherent episodes from the
same Task. This allows strongly related older evidence to survive temporal
decay. Any remaining budget preserves recent Task awareness. Candidates that
do not fit are skipped, small facts do not consume the same share as large
facts, and overlapping context is deduplicated.

Every selected operation records its retrieval score and timestamp. Repeated
retrieval strengthens a saturating activation value that fades with a 30-day
half-life while unused. That activation contributes to later ranking. Once it
is sufficiently strong, an operation can remain in automatic context solely as
reinforced memory, independently of the current semantic query. This bounded
consolidated layer is already present before the Memory Tool is invoked, so an
explicit recall remains focused on its requested subject.

The result identifies whether each operation was a recent anchor, relevant
anchor, or supporting context, together with its original Task, operation,
parent, global sequence, kind, source, recording method, tool, call, and
creation time. It also explains why the operation was selected: semantic
anchors include their numerical score, association, prior reinforcement, usage
count, most recent retrieval timestamp, and matching terms. Recent anchors state
that they came from explicit recency, and supporting operations identify the
anchor whose episode they explain. Presence in a recall result is evidence to
evaluate, not an instruction or a guarantee of relevance.

Failed Tasks and failed Tool results are eligible evidence. A successful Tool
result is eligible only when its owning Tool supplies its bounded
`modelOutput`; the complete raw result remains preserved independently. Recall
results themselves are excluded so Memory does not recursively retrieve copies
of earlier retrieval output.
