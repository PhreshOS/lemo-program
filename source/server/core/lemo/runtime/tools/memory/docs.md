# memory

Recalls durable context from Lemo's shared history. Pass the current subject as
`query`. The optional `budget` is an estimated-token budget from 256 through
16,000; the default is 8,000. Until an LLM Model exposes its tokenizer, Lemo
uses a deterministic UTF-8 estimate of four bytes per token.

Memory treats the query as its working focus. It favors distinctive matching
terms using their rarity across Memory, adds learned retrieval strength and
temporal proximity, and expands strong anchors into coherent episodes from the
same Task. Candidates that do not fit are skipped, small facts do not consume
the same share as large facts, and overlapping context is deduplicated.

Every selected operation records its retrieval score and timestamp. Repeated
retrieval strengthens a saturating activation value that fades with a 30-day
half-life while unused. That activation contributes to later ranking. Once it
is sufficiently strong, an operation can enter the Perceptual Field's `rules`
section independently of the current semantic query. The automatic
`semantic_memory` section selects by semantic relevance and ranks by
semantic relevance plus learned score and recency. `rules` selects by learned
score and ranks by learned score plus semantic relevance and recency.

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

Every result identifies its raw Task and operation. Use `tasks.read` to recover
the Task as a bounded XML event history, or `tasks.read_block` to read a truncated raw
operation completely in token pages.
