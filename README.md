# Lemo

The official PhreshOS agent Program.

Lemo operates through the same Program, Process, Endpoint, Service, and System
contracts available to other PhreshOS Programs.

## Model

The Server owns Lemo's authoritative database, Tasks, Model execution, Memory,
and Tools. The Client retains a live projection of that state and renders Tasks
and each Tool through its dedicated View.

```text
Lemo
├── Tasks
│   └── Cycles
│       ├── Model
│       ├── Perceptual Field
│       └── Tool calls
├── Memory
└── LLM Providers
```

A Task is a durable entity. Its input, Model events, Tool calls and results,
status, and relationships are recorded as one ordered history. A Cycle is one
disposable Model operation reconstructed from that history. Generated context
is not a second source of state.

Tools are ordinary discoverable contracts. Runtime validates their input,
executes independent calls concurrently, records their results, and starts
another Cycle when required. Client rendering resolves each known Tool to its
own View and falls back to the general Tool contract only when no dedicated View
exists.

## Models

Lemo supports OpenCode Zen, Ollama Cloud, and OpenRouter through independent LLM
Provider implementations. Providers own discovery, configuration, transport,
and Model construction. Models own their context-window and reasoning
capabilities.

Provider credentials and configuration remain authoritative Server state and do
not enter Task context or Client projections.

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

Build, attach the production definition, or package a release with:

```sh
bun run build
bun run start
bun run pack
```

`verify` checks the Provider, Task, Tool, Memory, Client projection, and
production artifact contracts.

## Repository boundary

This repository owns Lemo's agent domain and its Client representation. The
System remains the authority for PhreshOS state reached by Lemo's Tools; Lemo
uses the public System contracts rather than private integration.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the repository workflow and
[SECURITY.md](SECURITY.md) for private vulnerability reporting.

## License

Licensed under the [MIT License](LICENSE). Copyright © 2026 Zohayr SLILEH.
