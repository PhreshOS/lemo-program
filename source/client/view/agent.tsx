import Application from "@client/core/application"
import usePromise from "@libs/react-promise"
import { ContextProvider, useProcess } from "@phreshos/react"
import { context, type Process } from "@phreshos/client"
import { useEffect, useState } from "react"
import { StartupState } from "./state"
import Tasks from "./tasks"
import useProviderRevision from "./use-provider-revision"

export default function AgentRoute() {
    const readiness = usePromise(() => context.server.waitReady())

    if (readiness.isPending) return <StartupState title="Starting Lemo Agent…" />

    if (readiness.exception) return <StartupState
        title="Lemo Agent could not start"
        error={readiness.exception.current}
        retry={() => void readiness.safeExecute()}
    />

    return <ContextProvider
        context={context}
        fallback={<StartupState title="Starting Lemo Agent…" />}
    >
        <Agent />
    </ContextProvider>
}

function Agent() {

    const process = useProcess<Process>()
    const [application] = useState(() => new Application(process.server))
    const providerRevision = useProviderRevision(application.llmProviders)
    const models = usePromise(
        () => application.llmProviders.models(),
        [application, providerRevision]
    )

    useEffect(function () {

        application.start()

        return () => application.stop()

    }, [application])

    return <main className="shell">
        <div className="application">
            <Tasks application={application} models={models} />
        </div>
    </main>
}
