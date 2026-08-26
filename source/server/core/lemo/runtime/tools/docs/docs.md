# docs

Returns the complete documentation owned by one Runtime Tool:

```json
{ "name": "processes" }
```

Pass an exact name returned by `tools`. Documentation explains semantics that
cannot be inferred safely from JSON Schema alone, including defaults,
lifecycle, ordering, state ownership, limits, and failure behavior. It does
not load or execute the documented Tool.
