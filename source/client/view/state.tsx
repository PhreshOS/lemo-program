import { Button } from "@phreshos/react-ui"
import { Component, type ReactNode } from "react"
import icon from "../../../icon.png"

export function StartupState({ title, error, retry }: Readonly<{
    title: string
    error?: unknown
    retry?: () => void
}>) {

    return <div className="shell startup-state">
        <img className="identity-mark" src={icon} alt="" />
        <strong>{title}</strong>
        {error !== undefined && <p role="alert">{message(error)}</p>}
        {retry && <Button size="small" type="button" onPress={retry}>Retry</Button>}
    </div>
}

export class ApplicationBoundary extends Component<BoundaryProperties, BoundaryState> {

    public state: BoundaryState = { error: null }

    public static getDerivedStateFromError(error: unknown): BoundaryState {

        return { error }
    }

    public render() {

        if (this.state.error !== null) {
            // This boundary also covers Appearance loading failures, before UI
            // defaults are available. Keep its recovery control native.
            return <div className="startup-state" role="alert">
                <strong>Lemo could not start</strong>
                <p>{message(this.state.error)}</p>
                <button type="button" onClick={this.props.retry}>Retry</button>
            </div>
        }

        return this.props.children
    }
}

export function message(value: unknown) {

    return value instanceof Error ? value.message : String(value)
}

type BoundaryProperties = Readonly<{
    children: ReactNode
    retry(): void
}>

type BoundaryState = Readonly<{
    error: unknown | null
}>
