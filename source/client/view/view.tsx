import { useState } from "react"
import { Redirect, Route, Router, Switch } from "wouter"
import Agent from "./agent"
import Manager from "./manager"
import { ApplicationBoundary } from "./state"
import Appearance from "./appearance"
import "./style.css"

const routerBase = new URL(import.meta.env.BASE_URL, document.baseURI).pathname.replace(/\/$/, "")

/** Routes one Client document between the Lemo Manager and Agent Views. */
export default function View() {

    const [attempt, setAttempt] = useState(0)

    return <ApplicationBoundary key={attempt} retry={() => setAttempt(value => value + 1)}>
        <Appearance>
            <Router base={routerBase}>
                <Switch>
                    <Route path="/" component={Manager} />
                    <Route path="/agent" component={Agent} />
                    <Route><Redirect to="/" replace /></Route>
                </Switch>
            </Router>
        </Appearance>
    </ApplicationBoundary>
}
