import { Component, type ReactNode } from "react"

export function StartupState({ title, error, retry }: Readonly<{
    title: string
    error?: unknown
    retry?: () => void
}>) {

    return <main className="shell startup-state">
        <span className="identity-mark">L</span>
        <strong>{title}</strong>
        {error !== undefined && <p role="alert">{message(error)}</p>}
        {retry && <button className="quiet" type="button" onClick={retry}>Retry</button>}
    </main>
}

export class ApplicationBoundary extends Component<BoundaryProperties, BoundaryState> {

    public state: BoundaryState = { error: null }

    public static getDerivedStateFromError(error: unknown): BoundaryState {

        return { error }
    }

    public render() {

        if (this.state.error !== null) {
            return <StartupState title="Lemo could not start" error={this.state.error} retry={this.props.retry} />
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
