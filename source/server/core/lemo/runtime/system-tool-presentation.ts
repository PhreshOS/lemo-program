import type { SystemControlCapabilityName } from "@phreshos/core"

type Operation = Readonly<{
    description: string
    examples: readonly Readonly<Record<string, unknown>>[]
}>

type Capability<Operations extends string> = Readonly<{
    description: string
    guidance: readonly string[]
    operations: Readonly<Record<Operations, Operation>>
}>

type Presentation = Readonly<{
    program: Capability<"list" | "inspect" | "agent" | "wait">
    process: Capability<"list" | "inspect" | "create" | "findOrCreate" | "exit" | "wait">
    endpoint: Capability<"inspect" | "start" | "stop" | "waitReady" | "waitLifecycle" | "ask" | "publish" | "wait">
    window: Capability<"inspect" | "move" | "resize" | "setGeometry" | "minimize" | "changeTitle" | "raise" | "wait">
}>

const operation = (description: string, examples: readonly Readonly<Record<string, unknown>>[]): Operation => ({ description, examples })

/** Lemo-owned presentation for the neutral System operation contract. */
export const systemToolPresentation = {
    program: {
        description: "Discover PhreshOS Programs and their Program-specific agent documentation.",
        guidance: [
            "Inspect a Program before operating it. When hasAgent is true, read agent documentation before choosing launches, events, payloads, or cleanup.",
            "Program agent documentation contains only Program-owned policy. Generic Process and Endpoint mechanics remain in the System contract.",
            "An omitted Endpoint selection in a Process launch may inherit the Program default; omission is not equivalent to false."
        ],
        operations: {
            list: operation("List Programs with bounded filtering.", [{}]),
            inspect: operation("Read one Program declaration and installed state.", [{ program: "theme" }]),
            agent: operation("Read the Program's own agent operating policy. Fails when none is declared.", [{ program: "flambo" }]),
            wait: operation("Wait for one Program registry event, optionally scoped to one Program for forget or uninstall.", [{ event: "install", timeout: 30000 }])
        }
    },
    process: {
        description: "Discover and control live executions of Programs.",
        guidance: [
            "A Process may contain a Server Endpoint, a Client Endpoint, or both; its Program defines the valid topology.",
            "Before create, findOrCreate, or exit, inspect the Program and read its agent documentation when available.",
            "Use explicit server and client selections whenever topology matters. A Server-only launch sets server true and client false; a Client-only launch sets server false and selects client.",
            "findOrCreate requires a stable name. An existing Process with a different resolved launch is an error and is never silently reshaped."
        ],
        operations: {
            list: operation("List live Processes with bounded filtering.", [{}]),
            inspect: operation("Read one live Process and its Endpoint state.", [{ process: "process-identity" }]),
            create: operation("Create a Process. Omitted Endpoint selections inherit Program defaults.", [{ program: "theme" }]),
            findOrCreate: operation("Atomically find the named Process or create it with the same resolved launch.", [{ program: "lemo", launch: { name: "lemo", server: true, client: false } }]),
            exit: operation("Exit one Process and all of its live Endpoints.", [{ process: "process-identity" }]),
            wait: operation("Wait for one Process lifecycle event at System, Program, or Process scope.", [{ event: "create", program: "theme" }])
        }
    },
    endpoint: {
        description: "Inspect, control, and communicate with Server and Client Endpoints of live Processes.",
        guidance: [
            "Inspect the owning Program and read its agent documentation before using Program-specific events or lifecycle policy.",
            "Program documentation defines event names, payloads, results, and operating modes; this generic contract does not.",
            "An ask payload passes through unchanged. A successful response means only what the Program contract says it means.",
            "When a Program request changes authoritative state, its answer may be only an acknowledgment; observe the Program's documented publication for the resulting state."
        ],
        operations: {
            inspect: operation("Read whether one Endpoint is declared and running.", [{ process: "process-identity", endpoint: "server" }]),
            start: operation("Start a fresh Endpoint incarnation without implicitly changing the other Endpoint.", [{ process: "process-identity", endpoint: "client", launch: { service: false } }]),
            stop: operation("Stop one Endpoint. The final live Endpoint cannot be stopped; exit the Process instead.", [{ process: "process-identity", endpoint: "client" }]),
            waitReady: operation("Wait until the current or next Server incarnation reports readiness.", [{ process: "process-identity", endpoint: "server", timeout: 30000 }]),
            waitLifecycle: operation("Wait for one lifecycle transition of an exact Endpoint.", [{ process: "process-identity", endpoint: "client", event: "stop" }]),
            ask: operation("Ask a Server event and return its answer. Read Program agent documentation first for event and payload policy.", [{ process: "process-identity", endpoint: "server", event: "metrics" }]),
            publish: operation("Publish one event to a live Server or Client Endpoint without waiting for an answer.", [{ process: "process-identity", endpoint: "client", event: "refresh" }]),
            wait: operation("Wait for the next destinationless event emitted by one live Endpoint.", [{ process: "process-identity", endpoint: "server", event: "change" }])
        }
    },
    window: {
        description: "Inspect and control the authoritative Window of a live Client Endpoint.",
        guidance: [
            "Discover the Window through its Process; there is intentionally no Window list operation.",
            "Geometry numbers are absolute pixels. Use strings such as 50%, 1/2, or 50% - 8 for workspace-relative geometry.",
            "setGeometry changes position and size atomically.",
            "Window state is authoritative System state. Local Surface presentation is not part of this capability."
        ],
        operations: {
            inspect: operation("Read the complete current Window state.", [{ process: "process-identity" }]),
            move: operation("Change Window position.", [{ process: "process-identity", position: { x: 0, y: 0 } }]),
            resize: operation("Change Window size.", [{ process: "process-identity", size: { width: "50%", height: "100%" } }]),
            setGeometry: operation("Atomically change Window position and size.", [{ process: "process-identity", position: { x: 0, y: 0 }, size: { width: "50%", height: "100%" } }]),
            minimize: operation("Set Window visibility without changing its order.", [{ process: "process-identity", minimized: true }]),
            changeTitle: operation("Change the human-readable Window title.", [{ process: "process-identity", title: "Browser" }]),
            raise: operation("Raise the Window within its own layer without changing visibility or keyboard focus.", [{ process: "process-identity" }]),
            wait: operation("Wait for one authoritative Window change.", [{ process: "process-identity", event: "geometry" }])
        }
    }
} as const satisfies Presentation & Readonly<Record<SystemControlCapabilityName, Capability<string>>>
