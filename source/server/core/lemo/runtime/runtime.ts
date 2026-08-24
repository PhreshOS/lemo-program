import type { LLMToolCall, LLMToolDefinition } from "../../llm/model"
import type LemoDatabase from "../database"
import type Memory from "../memory"
import type { MemoryRecord } from "../memory"
import type Operation from "../operation"
import type Tool from "./tool"
import toolInput from "./tool-input"
import createDocs from "./tools/docs/docs"
import endpoints from "./tools/endpoints/endpoints"
import createMemory from "./tools/memory/memory"
import programs from "./tools/programs/programs"
import processes from "./tools/processes/processes"
import services from "./tools/services/services"
import time from "./tools/time/time"
import createTools from "./tools/tools/tools"
import windows from "./tools/windows/windows"

const builtIn = new Set(["tools", "docs", "memory"])

/** Lemo's internal owner and executor of available tools. */
export default class Runtime {

    private readonly tools: ReadonlyMap<string, Tool>

    public constructor(private readonly memory: Memory) {

        const catalog: Tool[] = []

        const source = () => catalog

        catalog.push(
            createTools(source),
            createDocs(source),
            createMemory(memory),
            time,
            programs,
            processes,
            endpoints,
            services,
            windows
        )

        this.tools = new Map(catalog.map(tool => [tool.definition.name, tool]))
    }

    /** Reconstructs the tools visible to the next Model cycle. */
    public async definitions(database: LemoDatabase, task: string): Promise<readonly LLMToolDefinition[]> {

        const loaded = loadedTools(await database.operations(task))

        return Object.freeze([...this.tools.values()]
            .filter(tool => builtIn.has(tool.definition.name) || loaded.has(tool.definition.name))
            .map(tool => tool.definition))
    }

    /** Executes independent tool calls concurrently and records each outcome. */
    public async execute(database: LemoDatabase, task: string, calls: readonly LLMToolCall[]) {

        await Promise.all(calls.map(call => this.executeCall(database, task, call)))
    }

    private async executeCall(database: LemoDatabase, task: string, call: LLMToolCall) {

        const tool = this.tools.get(call.name)

        if (!tool) {

            await database.appendToTask(task, "tool.result", {
                call: call.id,
                name: call.name,
                ok: false,
                error: `Unknown tool "${call.name}"`
            })

            return
        }

        const input = toolInput(call.input, tool.definition.parameters)

        if (!same(input, call.input)) {

            await database.appendToTask(task, "tool.input.normalized", {
                call: call.id,
                name: call.name,
                input
            })
        }

        const context = Object.freeze({
            task,
            call: call.id,
            record: (kind: string, payload: unknown) => database.appendToTask(task, `tool.${call.name}.${kind}`, {
                call: call.id,
                payload
            }),
            memory: Object.freeze({
                record: (value: MemoryRecord) => this.memory.record({
                    task,
                    tool: call.name,
                    call: call.id
                }, value)
            })
        })

        let output: unknown

        try {
            output = await tool.execute(input, context)
        } catch (cause) {

            const error = cause instanceof Error ? cause : new Error(String(cause))

            await database.appendToTask(task, "tool.result", {
                call: call.id,
                name: call.name,
                ok: false,
                error: error.message
            })

            return
        }

        await database.appendToTask(task, "tool.result", {
            call: call.id,
            name: call.name,
            ok: true,
            output
        })
    }
}

function loadedTools(operations: readonly Operation[]) {

    const loaded = new Set<string>()

    for (const operation of operations) {

        if (operation.kind !== "tool.tools.loaded") continue

        const value = record(operation.payload)

        const payload = record(value?.payload)

        if (!Array.isArray(payload?.names)) continue

        for (const name of payload.names) if (typeof name === "string") loaded.add(name)
    }

    return loaded
}

function record(value: unknown) {

    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null
}

function same(left: unknown, right: unknown) {

    return JSON.stringify(left) === JSON.stringify(right)
}
