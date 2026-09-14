# memory

Searches user requests, assistant messages, Tool-retained results, explicit facts,
and failures. Pass the subject as `query`.
The optional `budget` is an estimated-token budget from 256 through 16,000;
the default is 8,000. Estimates use UTF-8 bytes divided by four.

Results must match the query or supplied focus. Distinctive matching terms,
document-length normalization, explicit retrieval strength and recency determine ranking. Identical facts
from the same source and recording method appear once. Each result includes
its Task and operation identities, source, method, Tool, call, creation time,
selection score and matching terms. Evaluate this evidence before relying on it.

Explicit recall records retrieval scores and timestamps. Retrieval strength
saturates and fades with a 30-day half-life. Automatic cycle context uses the
same relevance selection within a bounded budget, without strengthening
memories merely because they were displayed.

Every result carries its origin: a user statement, an assistant claim, and a Tool
observation are distinct kinds of evidence. Tools select their retained results
and may record additional facts with a source and method. Recalling a record
does not copy its text into another retained result. Use `tasks.read` for a
bounded Task history, or `tasks.read_block` for token pages of a complete
retained operation.
