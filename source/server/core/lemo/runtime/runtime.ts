import type { LLMToolCall, LLMToolDefinition } from "../../llm/model"
import type LemoDatabase from "../database"
import type Memory from "../memory"
import type { MemoryRecord } from "../memory"
import type Operation from "../operation"
import { assertRunning, waitForRun, type TaskRun } from "../executions"
import type ClientChannel from "@server/core/client-channel"
import type Tool from "./tool"
import toolInput from "./tool-input"
import WaitAnswers, { type WaitAnswerRequest } from "./wait-answers"
import createDocs from "./tools/docs/docs"
import endpoints from "./tools/endpoints/endpoints"
import createMemory from "./tools/memory/memory"
import programs from "./tools/programs/programs"
import processes from "./tools/processes/processes"
import prompt from "./tools/prompt/prompt"
import services from "./tools/services/services"
import time from "./tools/time/time"
import createTools from "./tools/tools/tools"
import windows from "./tools/windows/windows"

const builtIn = new Set(["tools", "docs", "memory"])

/** Lemo's internal owner and executor of available tools. */
export default class Runtime {

    private readonly tools: ReadonlyMap<string, Tool>
    private readonly answers: WaitAnswers

    public constructor(private readonly memory: Memory, client: ClientChannel) {

        const catalog: Tool[] = []

        this.answers = new WaitAnswers(client)

        const source = () => catalog

        catalog.push(
            createTools(source),
            createDocs(source),
            createMemory(memory),
            time,
            programs,
            processes,
            prompt,
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
    public async execute(run: TaskRun, calls: readonly LLMToolCall[]) {

        await Promise.all(calls.map(call => this.executeCall(run, call)))
    }

    private async executeCall(run: TaskRun, call: LLMToolCall) {

        const tool = this.tools.get(call.name)

        if (!tool) {

            await run.append("tool.result", {
                call: call.id,
                name: call.name,
                ok: false,
                error: `Unknown tool "${call.name}"`
            })

            return
        }

        const input = toolInput(call.input, tool.definition.parameters)

        if (!same(input, call.input)) {

            await run.append("tool.input.normalized", {
                call: call.id,
                name: call.name,
                input
            })
        }

        const context = Object.freeze({
            task: run.task,
            call: call.id,
            signal: run.signal,
            record: (kind: string, payload: unknown) => run.append(`tool.${call.name}.${kind}`, {
                call: call.id,
                payload
            }),
            memory: Object.freeze({
                record: (value: MemoryRecord) => {

                    assertRunning(run.signal)

                    return this.memory.record({
                        task: run.task,
                        tool: call.name,
                        call: call.id
                    }, value)
                }
            }),
            waitAnswer: (request: WaitAnswerRequest) => this.answers.wait({
                task: run.task,
                call: call.id
            }, request, run.signal)
        })

        let output: unknown

        try {
            output = await waitForRun(tool.execute(input, context), run.signal)
        } catch (cause) {

            const error = cause instanceof Error ? cause : new Error(String(cause))

            await run.append("tool.result", {
                call: call.id,
                name: call.name,
                ok: false,
                error: error.message
            })

            return
        }

        await run.append("tool.result", {
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
