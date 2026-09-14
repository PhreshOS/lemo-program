import { expect, test } from "vitest"
import { parseLaunch } from "@phreshos/core"
import { launch } from "../source/server/core/lemo/runtime/system-input"
import processes from "../source/server/core/lemo/runtime/tools/processes/tool"
import endpoints from "../source/server/core/lemo/runtime/tools/endpoints/tool"
import programs from "../source/server/core/lemo/runtime/tools/programs/tool"
import windows from "../source/server/core/lemo/runtime/tools/windows/tool"

test("Process and Endpoint tools carry complete Core launch values", () => {
    const value = {
        name: "editor", options: { document: "notes.txt" }, server: { service: false },
        client: { service: true, title: "Notes", position: { x: "50%", y: 0 }, size: { width: 600, height: "1/2" }, layer: "over", minimize: true, maximize: true }
    }
    expect(launch.parse(value)).toEqual(parseLaunch(value))
    for (const action of ["create", "findOrCreate"]) {
        expect(processes.parse({ action, program: "example", launch: value }).input).toEqual({ action, program: "example", launch: value })
    }
    expect(endpoints.parse({ action: "start", process: "process-id", endpoint: "client", launch: value.client }).input)
        .toEqual({ action: "start", process: "process-id", endpoint: "client", launch: value.client })
    expect(() => endpoints.parse({ action: "start", process: "process-id", endpoint: "server", launch: value.client })).toThrow()
    expect(() => launch.parse({ client: { size: { width: "invalid", height: 100 } } })).toThrow()
})

test("documented tool examples satisfy their executable input contracts", () => {
    for (const tool of [processes, endpoints, programs, windows]) {
        for (const match of tool.docs.matchAll(/```json\n([\s\S]*?)\n```/g)) {
            expect(() => tool.parse(JSON.parse(match[1]!))).not.toThrow()
        }
    }
})

test("Process replacement preserves Launch validation for creation and named lookup", () => {
    const value = { name: "editor", replace: true }
    for (const action of ["create", "findOrCreate"]) {
        const request = { action, program: "example", launch: value }
        expect(processes.parse(request).input).toEqual({ ...request, launch: parseLaunch(value) })
        expect(() => processes.parse({ ...request, launch: { replace: true } })).toThrow()
    }
})
