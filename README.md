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

Lemo supports OpenCode Zen, Ollama Cloud, and OpenRouter through independent LLM
Provider implementations. Providers own discovery and transport; Models own
their context-window and reasoning capabilities.

A Task is durable ordered history. A Cycle is one disposable Model operation
reconstructed from that history. Tools are discoverable contracts whose input,
state, and result are validated, executed, recorded, and projected to Clients.

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
