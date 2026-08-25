import type { LLMProviderState } from "./llm/provider"
import type Operation from "./lemo/operation"

/** Authoritative Server state published to every representation of Lemo. */
export type ApplicationEvent = Readonly<{
    type: "lemo.operation"
    operation: Operation
}> | Readonly<{
    type: "llm-provider.changed"
    provider: string
    state: LLMProviderState
}> | Readonly<{
    type: "manager.startup.changed"
    enabled: boolean
}>
