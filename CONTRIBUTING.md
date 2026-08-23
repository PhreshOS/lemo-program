# Contributing

Lemo is a public PhreshOS Program built with MVC: Main, View, and Core.

## Development

Install the pinned toolchain and verify the complete repository:

```sh
bun install --frozen-lockfile
bun run verify
```

The repository must remain independently installable and runnable without a
PhreshOS workspace around it.

## Architecture

Both Client and Server preserve the same dependency direction:

```text
Main → View → Core
```

Main starts View. View constructs Core. Core owns application state and
behavior and must remain usable without View.
