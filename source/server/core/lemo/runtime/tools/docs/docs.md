# docs

Reads documentation owned by one Runtime Tool in token-bounded pages:

```json
{ "name": "processes" }
```

Pass an exact name returned by `tools`. Documentation explains semantics that
cannot be inferred safely from JSON Schema alone, including defaults,
lifecycle, ordering, state ownership, limits, and failure behavior. It does
not load or execute the documented Tool.

`tokens` defaults to 2,048 estimated tokens and accepts 256–16,000. The result
includes `docs`, `offset`, `next`, `tokens`, and `totalTokens`. Continue from
`next` as `offset` until it is `null`. Documentation is read from its owner;
pages are delivered live rather than copied into retained Task results.
