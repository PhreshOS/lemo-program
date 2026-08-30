import Application from "@client/core/application"
import usePromise from "@libs/react-promise"
import { CurrentProvider, useProcess } from "@phreshos/react"
import { useEffect, useState } from "react"
import { StartupState } from "./state"
import Tasks from "./tasks"
import useProviderRevision from "./use-provider-revision"

export default function AgentRoute() {

    return <CurrentProvider
        provide={["process"]}
        waitServer
        fallback={<StartupState title="Starting Lemo Agent…" />}
    >
        <Agent />
    </CurrentProvider>
}

function Agent() {

    const process = useProcess()
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
