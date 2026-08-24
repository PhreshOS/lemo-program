# prompt

Presents one prompt to the user inside the Task that called this tool and waits
for the first Client response. Pass `content` containing the complete question
the user should see.

The prompt is temporary. Runtime owns its placement, correlation, capacity,
timeout, and release. A successful call returns `{ "answer": string }`. A call
fails when the queue is full or no Client responds before the timeout.
