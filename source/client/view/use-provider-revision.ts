import type LLMProviders from "@client/core/llm/providers"
import { useCallback, useSyncExternalStore } from "react"

/** Represents Client Core's live LLM Provider projection in React. */
export default function useProviderRevision(providers: LLMProviders) {

    const subscribe = useCallback((listener: () => void) => providers.subscribe(listener), [providers])
    const snapshot = useCallback(() => providers.revision(), [providers])

    return useSyncExternalStore(subscribe, snapshot, snapshot)
}
