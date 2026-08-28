import { useState } from "react"
import { Redirect, Route, Router, Switch } from "wouter"
import Agent from "./agent"
import Manager from "./manager"
import { ApplicationBoundary } from "./state"
import "./style.css"

/** Routes one Client document between the Lemo Manager and Agent Views. */
export default function View() {

    const [attempt, setAttempt] = useState(0)

    return <ApplicationBoundary key={attempt} retry={() => setAttempt(value => value + 1)}>
        <Router base={programAssetsBase()}>
            <Switch>
                <Route path="/" component={Manager} />
                <Route path="/agent" component={Agent} />
                <Route><Redirect to="/" replace /></Route>
            </Switch>
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
