import Manager from "@client/core/manager"
import type LLMProviders from "@client/core/llm/providers"
import usePromise from "@libs/react-promise"
import { ContextProvider, useProcess, useProgram } from "@phreshos/react"
import { context, type Process, type Program } from "@phreshos/client"
import { useCallback, useEffect, useSyncExternalStore } from "react"
import LLMProviderViews from "./llm-providers"
import { message, StartupState } from "./state"
import useProviderRevision from "./use-provider-revision"

export default function ManagerRoute() {

    return <ContextProvider
        context={context}
        fallback={<StartupState title="Opening Lemo Manager…" />}
    >
        <ManagerLoader />
    </ContextProvider>
}

function ManagerLoader() {

    const program = useProgram<Program>()
    const process = useProcess<Process>()
    const manager = usePromise(() => Manager.open(program, process), [program, process])

    useEffect(() => () => manager.solve?.stop(), [manager.solve])

    if (manager.isPending) return <StartupState title="Starting Lemo…" />

    if (manager.exception) return <StartupState
        title="Lemo Server could not start"
        error={manager.exception.current}
        retry={() => void manager.safeExecute()}
    />

    return <ManagerProviders manager={manager.solve} />
}

function ManagerProviders({ manager }: Readonly<{ manager: Manager }>) {

    const providers = usePromise(() => manager.llmProviders(), [manager])

    if (providers.isPending) return <StartupState title="Loading LLM Providers…" />

    if (providers.exception) return <StartupState
        title="LLM Providers are unavailable"
        error={providers.exception.current}
        retry={() => void providers.safeExecute()}
    />

    return <ManagerView manager={manager} providers={providers.solve} />
}

function ManagerView({ manager, providers }: Readonly<{
    manager: Manager
    providers: LLMProviders
}>) {

    const providerRevision = useProviderRevision(providers)
    const startupRevision = useStartupRevision(manager)
    const models = usePromise(() => providers.models(), [providers, providerRevision])
    const startup = usePromise(() => manager.startup(), [manager, startupRevision])
    const launch = usePromise(() => manager.launch())
    const configureStartup = usePromise(async function (enabled: boolean) {

        await manager.enableStartup(enabled)
    })

    useEffect(() => () => {

        providers.stop()
    }, [providers])

    const startupFailure = startup.exception?.current ?? configureStartup.exception?.current

    return <main className="shell manager-shell">
        <div className="manager-page">
            <header className="manager-header">
                <div className="identity">
                    <span className="identity-mark" title="Lemo Manager">L</span>
                    <div className="identity-text">
                        <div className="identity-title-row"><h1>Lemo Manager</h1></div>
                        <p className="identity-sub">Agent and LLM configuration</p>
                    </div>
                </div>

                <button
                    className="primary"
                    type="button"
                    disabled={launch.isPending}
                    onClick={() => void launch.safeExecute()}
                >
                    {launch.isPending ? "Opening…" : "Open Agent"}
                </button>
            </header>

            <div className="manager-content">
                <section className="manager-section startup-setting">
                    <div>
                        <p className="section-kicker">Lifecycle</p>
                        <h2>Start Lemo automatically</h2>
                        <p>Launch the fixed Lemo Server when PhreshOS starts. The Server opens its own Agent Client.</p>
                    </div>

                    <label className="switch-control">
                        <input
                            type="checkbox"
                            checked={startup.solve ?? false}
                            disabled={startup.isPending || configureStartup.isPending}
                            onChange={event => void configureStartup.safeExecute(event.target.checked)}
                        />
                        <span>{startup.isPending ? "Loading…" : startup.solve ? "Enabled" : "Disabled"}</span>
                    </label>

                    {startupFailure !== undefined && <div className="resource-error" role="alert">
                        <p>{message(startupFailure)}</p>
                        <button type="button" onClick={() => void startup.safeExecute()}>Retry</button>
                    </div>}
                </section>

                <section className="manager-section providers-section">
                    <div className="manager-section-heading">
                        <div>
                            <p className="section-kicker">Configuration</p>
                            <h2>LLM Providers</h2>
                        </div>
                        <span className="manager-model-count">
                            {models.isPending ? "Loading Models…" : models.exception ? "Models unavailable" : `${models.solve.length} Models`}
                        </span>
                    </div>

                    <LLMProviderViews providers={providers} models={models} />
                </section>

                {launch.exception && <div className="resource-error" role="alert">
                    <p>{message(launch.exception.current)}</p>
                    <button type="button" onClick={() => void launch.safeExecute()}>Try again</button>
                </div>}
            </div>
        </div>
    </main>
}

function useStartupRevision(manager: Manager) {

    const subscribe = useCallback((listener: () => void) => manager.subscribeStartup(listener), [manager])
    const snapshot = useCallback(() => manager.startupVersion(), [manager])

    return useSyncExternalStore(subscribe, snapshot, snapshot)
}
