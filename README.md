# Lemo

The PhreshOS agent Program.

[Programs](https://docs.phreshos.com/runtime/programs) ·
[Communication](https://docs.phreshos.com/runtime/communication) ·
[Permissions](https://docs.phreshos.com/system/security) ·
[Source](https://github.com/PhreshOS/lemo-program)

## Role

Lemo's Server owns its Tasks, Cycles, Model execution, Memory, Tools, providers,
and authoritative database. Its Client retains a live projection and resolves
each Tool contract to a dedicated View when one exists.

Lemo uses the same Program, Process, Endpoint, Service, Context, and System
contracts as every other Program. Its Tools consume public capabilities; Lemo
does not define System operations or contracts for other Programs.

## Models and Tools

Lemo supports OpenCode Zen, Ollama Cloud, OpenRouter, and NVIDIA through independent LLM
Provider implementations. Providers own discovery and transport; Models own
their context-window and reasoning capabilities.

A Task is durable ordered history. A Cycle is one disposable Model operation
reconstructed from that history and the active Task's live Tool results.
Tools are discoverable contracts whose input,
state, and result are validated, executed, recorded, and projected to Clients.

Every Tool defines `retain(output, input)` to select the result data saved for
each call; returning `null` retains no result data. The live result is available
throughout the active Task without being persisted. It survives pause/continue
in the same Lemo process and is released when the Task finishes or is cancelled.
After a process restart, only Tool-retained data is available; other results are
explicitly marked unavailable. Tools may also record explicit facts
through `context.memory.record()`, including their source and recording method.
Conversation, selected results, explicit facts, and failures remain searchable.
`tasks.read` and `tasks.read_block` provide bounded access to retained history.

Each Cycle recalls relevant, deduplicated cross-Task evidence within at most
8,000 estimated tokens. Initial input is capped at 35% of the Model's context
window; after the first Model response, ongoing Task input is capped at 70%.
These ceilings include instructions, Tool definitions, recalled evidence, and
the Task conversation. Continuing a paused Task with an existing response uses
the ongoing ceiling. When capacity is unknown, a 65,536-token fallback is used.
Capacity is a ceiling, not a target to fill with history from other Tasks.

The Task's user request, assistant messages, and call/result pairs remain in
context. Under capacity pressure, large Tool arguments/results become labelled
excerpts without rewriting their live or retained records. If the conversation
itself cannot fit even with excerpts, generation fails explicitly rather than
silently losing earlier decisions. Token budgets are UTF-8 estimates, not exact
Model token counts. Automatic recall does not reinforce its own selections.

## Installation

```sh
phresh install lemo --run
```

## Development

```sh
bun install --frozen-lockfile
bun run verify
bun run dev
```

Build, run the production definition, or package a release with:

```sh
bun run build
bun run start
bun run pack
```

`verify` checks Provider, Task, Tool, Memory, Client projection, and production
artifact contracts.

`check` performs static checks, `build` creates distributable output, and `test`
runs Vitest assertions from `tests/`. Run `build` before testing built artifacts.
`verify` runs `check`, `build`, and `test` in order. Operational tooling belongs
in `scripts/`; tests and their fixtures belong in `tests/`. Verification uses
the committed dependency graph without local package substitutions.

## Related repositories

- [PhreshOS System](https://github.com/PhreshOS/system) owns the runtime and host
  capabilities used by Tools.
- [`@phreshos/core`](https://github.com/PhreshOS/core) owns the shared domains
  through which Lemo reaches the System and other Programs.
- [Flambo](https://github.com/PhreshOS/flambo-program) provides browser
  capabilities through its public Service.
- [Terminal](https://github.com/PhreshOS/terminal-program) provides host PTY
  sessions through its Program boundary.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the repository workflow and
[SECURITY.md](SECURITY.md) for private vulnerability reporting.

## License

Licensed under the [MIT License](LICENSE). Copyright © 2026 Zohayr SLILEH.

`test:live` explicitly selects external-service tests. They require network
access and, for providers, credentials; provider calls may incur costs.
