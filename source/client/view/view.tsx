import { lazy, Suspense, useState } from "react"
import { Redirect, Route, Router, Switch } from "wouter"
import { ApplicationBoundary, StartupState } from "./state"
import "./style.css"

const Manager = lazy(() => import("./manager"))
const Agent = lazy(() => import("./agent"))

/** Routes one Client document without eagerly loading the other Lemo View. */
export default function View() {

    const [attempt, setAttempt] = useState(0)

    return <ApplicationBoundary key={attempt} retry={() => setAttempt(value => value + 1)}>
        <Router base={programAssetsBase()}>
            <Suspense fallback={<StartupState title="Opening Lemo…" />}>
                <Switch>
                    <Route path="/" component={Manager} />
                    <Route path="/agent" component={Agent} />
                    <Route><Redirect to="/" replace /></Route>
                </Switch>
            </Suspense>
        </Router>
    </ApplicationBoundary>
}

function programAssetsBase() {

    const path = window.location.pathname
    const marker = "/assets"

    if (!path.startsWith("/program/")) return undefined

    const end = path.indexOf(marker)

    return end < 0 ? undefined : path.slice(0, end + marker.length)
}
