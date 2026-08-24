# memory

Recalls durable context from Lemo's shared history. Pass the current subject as
`query`. You may request between 1 and 20 results; the default is 20.

Half of the result radius preserves recent context. The other half favors
history that is both lexically related to the query and temporally close. The
result identifies the original Task and operation for every selected fact.

