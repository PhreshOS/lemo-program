# Lemo

The public PhreshOS agent Program.

```bash
bun install
bun run dev
```

Lemo follows PhreshOS MVC, meaning Main, View, and Core:

```text
source/
├── client/
│   ├── main.tsx
│   ├── view/
│   │   ├── style.css
│   │   └── view.tsx
│   └── core/
│       └── application.ts
└── server/
    ├── main.ts
    ├── view/
    │   └── view.ts
    └── core/
        └── application.ts
```

Each Main starts its View, each View constructs its Core, and Core owns the
application.

## LLM contracts

Language-model capabilities are explicitly named `LLMProvider` and
`LLMModel`, leaving `Provider` and `Model` available to other capability
families.

An LLM Provider owns its Models. An LLM Model retains the bidirectional
relationship to its Provider and owns executable model behavior. Lemo will
receive an LLM Model for an operation, never its Provider.

Server Core retains only initialized LLM Providers in `LLMProviders`.
There is no generic configuration shape.

Ollama Cloud owns its `{ apiKey }` configuration contract, raw HTTP transport,
Zod schema, raw HTTP transport, model discovery, and LLM Model construction.
The TypeScript configuration contract is derived from that schema. Server Core
reads its raw value from `ollama-cloud:config` in the Program store and
constructs the Provider only when that key exists. No environment variable
configures an LLM Provider.

Every configured LLM Provider also retains an independent `active` property at
`<provider-identity>:active`. Inactive and unconfigured Providers are excluded
from Model loading. Loading all Models is one strict operation: if any active,
configured Provider fails, the complete operation fails without converting the
error into an empty Model list.

Client Core always retains an explicit Ollama Cloud configuration handle,
including while the authoritative Provider is unconfigured. It can inspect the
safe configured state, replace or remove configuration, discover Models, and
use each retained LLM Model directly. Client View renders Ollama Cloud through
its own integration; it never receives the stored API key.

## Lemo database

Server Core wakes the one enduring Lemo entity through:

```ts
const lemo = await Lemo.wakeUp(database)
```

Lemo accepts the PhreshOS Program database or a normal Node.js `DatabaseSync`
instance. Its schema retains Tasks, globally ordered raw operations, their
original Task and parent relationships, and arbitrary relationships between
operations. Raw payloads remain JSON without summaries, embeddings, retrieval
scores, decay values, or inferred semantic structure.
