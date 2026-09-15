import { afterEach, expect, test, vi } from "vitest"
import { system } from "@phreshos/server"
import type { Process, Program, WindowOperations, WindowState } from "@phreshos/core"
import windows from "../source/server/core/lemo/runtime/tools/windows/tool"
import type { ToolContext } from "../source/server/core/lemo/runtime/tool"

afterEach(() => vi.restoreAllMocks())

function fixture(layer: WindowState["layer"]) {
    let state: WindowState = {
        title: "Example", position: { x: 10, y: 20 }, size: { width: 300, height: 200 },
        minimized: false, maximized: false, front: false, layer
    }
    const operations = {
        move: vi.fn(async (position) => { state = { ...state, position } }),
        resize: vi.fn(async (size) => { state = { ...state, size } }),
        setGeometry: vi.fn(async (geometry) => { state = { ...state, ...geometry } }),
        minimize: vi.fn(async (minimized = true) => { state = { ...state, minimized } }),
        maximize: vi.fn(async (maximized = true) => { state = { ...state, maximized } }),
        changeTitle: vi.fn(async (title) => { state = { ...state, title } }),
        raise: vi.fn(async () => { state = { ...state, front: true } })
    } satisfies WindowOperations
    const close = vi.fn(async () => ({ done: true as const, value: undefined }))
    const events = vi.fn(() => ({
        next: async () => ({ done: false as const, value: true }),
        return: close
    }))
    const window = {
        ...operations,
        title: async () => state.title,
        position: async () => state.position,
        size: async () => state.size,
        minimized: async () => state.minimized,
        maximized: async () => state.maximized,
        front: async () => state.front,
        layer: async () => state.layer,
        events
    }
    const exists = vi.fn(async () => true)
    const program = { identity: "example", client: {} }
    const process = { identity: "process-id", program: async () => program, client: { window, exists } }
    vi.spyOn(system.process, "find").mockResolvedValue(process as unknown as Process)
    const findLocal = vi.fn(async () => process)
    vi.spyOn(system.program, "find").mockResolvedValue({ findProcess: findLocal } as unknown as Program)
    const context = { invocation: { signal: new AbortController().signal } } as ToolContext
    const invoke = (request: Record<string, unknown>) => windows.execute(windows.parse({ process: "process-id", ...request }).input, context)
    return { invoke, operations, exists, program, events, close, findLocal }
}

test.each(["window", "under", "over"] as const)("window operations preserve authoritative state on %s", async layer => {
    const { invoke, operations } = fixture(layer)
    await expect(invoke({ action: "maximize" })).resolves.toMatchObject({ maximized: true, minimized: false, layer })
    await expect(invoke({ action: "minimize" })).resolves.toMatchObject({ maximized: true, minimized: true })
    await expect(invoke({ action: "raise" })).resolves.toMatchObject({ maximized: true, minimized: true, front: true })
    const geometry = { position: { x: "50% - 8", y: 0 }, size: { width: "1/2", height: "100%" } }
    await expect(invoke({ action: "setGeometry", ...geometry })).resolves.toMatchObject({ ...geometry, maximized: true, minimized: true })
    expect(operations.setGeometry).toHaveBeenCalledExactlyOnceWith(geometry)
    expect(operations.move).not.toHaveBeenCalled()
    expect(operations.resize).not.toHaveBeenCalled()
    await expect(invoke({ action: "minimize", minimized: false })).resolves.toMatchObject({ maximized: true, minimized: false })
    await expect(invoke({ action: "maximize", maximized: false })).resolves.toMatchObject({ ...geometry, maximized: false })
    await invoke({ action: "move", position: { x: 5, y: 6 } })
    await invoke({ action: "resize", size: { width: 100, height: 90 } })
    await invoke({ action: "changeTitle", title: "New title" })
    await expect(invoke({ action: "inspect" })).resolves.toEqual({
        process: "process-id", title: "New title", position: { x: 5, y: 6 },
        size: { width: 100, height: 90 }, minimized: false, maximized: false, front: true, layer
    })
})

test("window waits observe maximization and release their subscription", async () => {
    const { invoke, events, close } = fixture("window")
    await expect(invoke({ action: "wait", event: "maximize" })).resolves.toEqual({ process: "process-id", event: "maximize", payload: true })
    expect(events).toHaveBeenCalledWith("maximize", expect.objectContaining({ capacity: 1 }))
    expect(close).toHaveBeenCalledOnce()
})

test("window lookup respects Program-local names and requires a running Client", async () => {
    const { invoke, findLocal, exists, operations } = fixture("window")
    await invoke({ action: "inspect", process: "editor", program: "example" })
    expect(findLocal).toHaveBeenCalledWith("editor")
    exists.mockResolvedValue(false)
    await expect(invoke({ action: "maximize" })).rejects.toThrow("no running Client Endpoint")
    expect(operations.maximize).not.toHaveBeenCalled()
})
