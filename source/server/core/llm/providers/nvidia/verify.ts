import assert from "node:assert/strict"
import type { ProgramStore } from "@phreshos/core"
import type { LLMModelEvent, LLMModelUsage } from "../../model"
import NvidiaProvider, { registration } from "./provider"
import nvidiaConfiguration from "./configuration"

const modelId = "vendor/tool-model"
const metadata = { tool_call: true, modalities: { input: ["text"], output: ["text"] }, limit: { context: 32768 }, reasoning_options: [{ type: "effort", values: ["low", "high"] }] }
const tool = { name: "sum", description: "Add two numbers", parameters: { type: "object", properties: { a: { type: "number" }, b: { type: "number" } }, required: ["a", "b"] } }
const requests: Request[] = []
const bodies: Record<string, unknown>[] = []
let mode = "tools"

function chunk(delta: unknown, finish_reason: string | null = null) {

    return { id: "completion", object: "chat.completion.chunk", created: 1, model: modelId, choices: [{ index: 0, delta, finish_reason }] }
}

const request: typeof fetch = async (input, init) => {

    const request = new Request(input, init)

    requests.push(request)

    if (request.url === "https://models.dev/api.json") {

        assert.equal(request.headers.has("authorization"), false)

        if (mode === "catalog-error") return new Response("unavailable", { status: 503 })

        if (mode === "invalid-catalog") return Response.json({ nvidia: { models: { [modelId]: { ...metadata, limit: { context: -1 } } } } })

        return Response.json({ nvidia: { models: {
            [modelId]: metadata,
            "vendor/no-context": { ...metadata, limit: undefined, reasoning_options: [{ type: "toggle" }] },
            "vendor/absent": metadata,
            "vendor/embedding": { ...metadata, tool_call: false },
            "vendor/deprecated": { ...metadata, status: "deprecated" }
        } } })
    }

    assert.equal(request.headers.get("authorization"), "Bearer test-key")

    if (request.url.endsWith("/models")) return Response.json({ object: "list", data: [modelId, "vendor/no-context", "vendor/embedding", "vendor/deprecated", "vendor/unknown"].map(id => ({ id, object: "model", created: 1, owned_by: "vendor" })) })

    assert.equal(request.url, "https://integrate.api.nvidia.com/v1/chat/completions")

    bodies.push(await request.json())

    if (mode === "http-error") return Response.json({ error: { message: "Quota exceeded", type: "rate_limit_error" } }, { status: 429 })

    if (mode === "abort") return new Response(new ReadableStream({
        start(controller) {

            request.signal.addEventListener("abort", () => controller.error(request.signal.reason), { once: true })
        }
    }), { headers: { "content-type": "text/event-stream" } })

    const events = mode === "tools" ? [
        chunk({ content: "Adding " }),
        chunk({ content: "✓", tool_calls: [{ index: 0, id: "call-sum", type: "function", function: { name: "sum", arguments: '{"a":' } }] }),
        chunk({ tool_calls: [{ index: 0, function: { arguments: '2,"b":3}' } }] }),
        chunk({}, "tool_calls"),
        { choices: [], usage: { prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 30 }, completion_tokens_details: { reasoning_tokens: 5 } } }
    ] : mode === "incomplete" ? [chunk({ content: "partial" })]
        : mode === "length" ? [chunk({}, "length")]
        : mode === "invalid-tool" ? [chunk({ tool_calls: [{ index: 0, id: "call-sum", type: "function", function: { name: "sum", arguments: "{" } }] }, "tool_calls")]
        : mode === "stream-error" ? [{ error: { message: "Stream failed", type: "server_error" } }]
        : [chunk({ content: "5" }, "stop")]

    const bytes = new TextEncoder().encode(events.map(event => `data: ${JSON.stringify(event)}\r\n\r\n`).join("") + "data: [DONE]\r\n\r\n")

    return new Response(new ReadableStream({ start(controller) {

        for (let index = 0; index < bytes.length; index += 7) controller.enqueue(bytes.slice(index, index + 7))

        controller.close()
    } }), { headers: { "content-type": "text/event-stream" } })
}

const provider = new NvidiaProvider({ apiKey: "test-key" }, true, request)
const [models, concurrent] = await Promise.all([provider.models(), provider.models()])

assert.equal(models, concurrent)
assert.deepEqual(models.map(model => model.id), [modelId, "vendor/no-context"])
assert.equal(requests.length, 2)
assert.equal((await provider.models())[0], models[0])
assert.equal(await models[0]!.contextWindow(), 32768)
assert.equal(await models[1]!.contextWindow(), null)
assert.equal(await models[1]!.reasoningLevels(), null)
assert.deepEqual(await models[0]!.reasoningLevels(), { levels: ["low", "high"], default: null, required: true })
await assert.rejects(models[0]!.setReasoning("medium"), /does not support/)
await models[0]!.setReasoning("low")

const first = await collect(models[0]!.generate({ messages: [{ role: "user", content: "Add 2 and 3" }], tools: [tool] }))

assert.deepEqual(first.events, [
    { type: "text", content: "Adding " },
    { type: "text", content: "✓" },
    { type: "tool-call", call: { id: "call-sum", name: "sum", input: { a: 2, b: 3 } } }
])
assert.deepEqual(first.usage, { input: { tokens: 100, cachedTokens: 30 }, output: { tokens: 20, reasoningTokens: 5 } })
assert.deepEqual(bodies[0], { model: modelId, messages: [{ role: "user", content: "Add 2 and 3" }], tools: [{ type: "function", function: tool }], reasoning_effort: "low", stream: true, stream_options: { include_usage: true } })

mode = "text"

const second = await collect(models[1]!.generate({ messages: [
    { role: "assistant", content: "", toolCalls: [{ id: "call-sum", name: "sum", input: { a: 2, b: 3 } }] },
    { role: "tool", call: "call-sum", name: "sum", content: "5" }
], tools: [] }))

assert.equal(second.usage, null)
assert.deepEqual(second.events, [{ type: "text", content: "5" }])
assert.equal("reasoning_effort" in bodies[1]!, false)
assert.deepEqual(bodies[1]!.messages, [
    { role: "assistant", content: null, tool_calls: [{ id: "call-sum", type: "function", function: { name: "sum", arguments: '{"a":2,"b":3}' } }] },
    { role: "tool", tool_call_id: "call-sum", content: "5" }
])

for (const [value, expected] of [["http-error", /Quota exceeded/], ["stream-error", /Stream failed/], ["incomplete", /incomplete generation/], ["length", /ended generation with length/], ["invalid-tool", /JSON|property name/i]] as const) {

    mode = value

    const before = bodies.length

    await assert.rejects(collect(models[0]!.generate({ messages: [], tools: [] })), expected)

    assert.equal(bodies.length, before + 1)
}

mode = "abort"

const controller = new AbortController()
const pending = collect(models[0]!.generate({ messages: [], tools: [] }, { signal: controller.signal }))

setTimeout(() => controller.abort(), 10)

await assert.rejects(pending, /abort/i)

for (const value of ["catalog-error", "invalid-catalog"]) {

    mode = value

    const failing = new NvidiaProvider({ apiKey: "test-key" }, true, request)

    await assert.rejects(failing.models())

    mode = "text"

    assert.equal((await failing.models()).length, 2)
}

assert.throws(() => nvidiaConfiguration({ apiKey: " " }))

const values = new Map<string, unknown>()
const store: ProgramStore = {
    async get<Value>(key: string) { return values.get(key) as Value | undefined },
    async set(key, value) { values.set(key, value); return true },
    async delete(key) { return (Array.isArray(key) ? key : [key]).map(value => values.delete(value)).some(Boolean) },
    async has(key) { return values.has(key) },
    async clear() { values.clear() }
}
const handle = await registration.open(store)

assert.deepEqual(handle.state(), { configured: false, active: true })
await handle.configure({ apiKey: "test-key" })
assert.deepEqual(handle.state(), { configured: true, active: true })
assert.equal(handle.provider?.name, "NVIDIA")
await handle.deactivate()
assert.equal((await registration.open(store)).provider?.active, false)
await handle.activate()
assert.equal(handle.provider?.active, true)
await handle.removeConfiguration()
assert.equal(handle.provider, null)
assert.equal(values.has("nvidia:config"), false)

console.log("NVIDIA provider contracts verified")

async function collect(generator: AsyncGenerator<LLMModelEvent, LLMModelUsage | null, unknown>) {

    const events: LLMModelEvent[] = []

    while (true) {

        const result = await generator.next()

        if (result.done) return { events, usage: result.value }

        events.push(result.value)
    }
}
