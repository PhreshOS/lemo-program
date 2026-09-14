# memory

Recalls facts deliberately retained by Tools. Pass the subject as `query`.
The optional `budget` is an estimated-token budget from 256 through 16,000;
the default is 8,000. Estimates use UTF-8 bytes divided by four.

Results must match the query or supplied focus. Distinctive matching terms,
explicit retrieval strength and recency determine ranking. Identical facts
from the same source and recording method appear once. Each result includes
its Task and operation identities, source, method, Tool, call, creation time,
selection score and matching terms. Evaluate this evidence before relying on it.

Explicit recall records retrieval scores and timestamps. Retrieval strength
saturates and fades with a 30-day half-life. Automatic cycle context uses the
same relevance selection within a bounded budget, without strengthening
memories merely because they were displayed.

Tools choose useful facts through `context.memory.record({ content, source,
method })`; recording nothing is valid. Execution previews and raw operation
history serve a separate purpose: continuing and inspecting work. Use
`tasks.read` for a bounded Task history, or `tasks.read_block` for token pages
of a complete raw operation.
