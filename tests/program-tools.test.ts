import { afterEach, expect, test, vi } from "vitest"
import { system } from "@phreshos/server"
import type { Launch, Program } from "@phreshos/core"
import programs from "../source/server/core/lemo/runtime/tools/programs/tool"
import type { ToolContext } from "../source/server/core/lemo/runtime/tool"

afterEach(() => vi.restoreAllMocks())

test("Program inspection preserves endpoint declarations and saved launches stay separate", async () => {
    let saved: Launch | null = null
    const declaration: Program["client"] = {
        start: true, service: false, title: "Example", position: null,
        size: null, layer: "window", minimize: false, maximize: true
    }
    const set = vi.fn(async (value: Launch) => { saved = value })
    const create = vi.fn()
    const program = {
        identity: "example", name: "Example", version: null, description: null,
        hasAgent: false, installed: async () => true,
        client: declaration, server: { start: false, service: true },
        process: { create }, launch: { get: async () => saved, set }
    }
    vi.spyOn(system.program, "find").mockResolvedValue(program as unknown as Program)
    const invoke = (request: Record<string, unknown>) => programs.execute(programs.parse({ program: "example", ...request }).input, {} as ToolContext)
    await expect(invoke({ action: "inspect" })).resolves.toMatchObject({ client: declaration, server: program.server })
    await expect(invoke({ action: "getLaunch" })).resolves.toBeNull()
    const launch: Launch = { client: { maximize: true }, options: { document: "notes.txt" } }
    await expect(invoke({ action: "setLaunch", launch })).resolves.toEqual(launch)
    expect(set).toHaveBeenCalledExactlyOnceWith(launch)
    await expect(invoke({ action: "getLaunch" })).resolves.toEqual(launch)
    expect(create).not.toHaveBeenCalled()
    expect(() => programs.parse({ action: "setLaunch", program: "example", launch: true })).toThrow()
})
