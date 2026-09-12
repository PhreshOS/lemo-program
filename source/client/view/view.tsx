import { useState } from "react"
import { context } from "@phreshos/client"
import Agent from "./agent"
import Manager from "./manager"
import usePromise from "@libs/react-promise"
import { ApplicationBoundary, StartupState } from "./state"
import Appearance from "./appearance"
import "./style.css"

/** Selects the view from the immutable role of this Process. */
export default function View() {

    const [attempt, setAttempt] = useState(0)

    return <ApplicationBoundary key={attempt} retry={() => setAttempt(value => value + 1)}>
        <Appearance>
            <ProcessView />
        </Appearance>
    </ApplicationBoundary>
}

function ProcessView() {

    const role = usePromise(() => context.options<"agent">("view"), [])

    if (role.isPending) return <StartupState title="Opening Lemo…" />

    if (role.exception) return <StartupState title="Lemo could not identify its view" error={role.exception.current} />

    return role.solve === "agent" ? <Agent /> : <Manager />
}
