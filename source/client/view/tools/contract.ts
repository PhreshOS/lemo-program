import type { ToolSnapshot } from "@client/core/lemo/tool"

export function input(snapshot: ToolSnapshot) {

    return record(snapshot.input)
}

export function text(value: unknown) {

    return typeof value === "string" ? value : ""
}

export function action(snapshot: ToolSnapshot, fallback: string) {

    return text(input(snapshot)?.action) || fallback
}

export function record(value: unknown) {

    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null
}
