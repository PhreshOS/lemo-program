/** One raw, globally ordered fact recorded by Lemo. */
export default interface Operation {
    readonly sequence: number
    readonly id: string
    readonly task: string | null
    readonly parent: string | null
    readonly kind: string
    readonly payload: unknown
    readonly createdAt: number
}

/** Input used to append one raw operation. */
export type OperationInput = Readonly<{
    task: string | null
    parent: string | null
    kind: string
    payload: unknown
}>
