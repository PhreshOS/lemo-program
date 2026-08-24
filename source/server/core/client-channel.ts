/** General-purpose communication with the Client paired to this Server. */
export default interface ClientChannel {
    publish(event: string, payload?: unknown): void
    subscribe(event: string, listener: (payload: unknown) => void): () => void
}
