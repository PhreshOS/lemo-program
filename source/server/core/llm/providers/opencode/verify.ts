import assert from "node:assert/strict"
import OpenCodeProvider from "./provider"

const requests: string[] = []
const tool = {
    name: "time",
    description: "Return time",
    parameters: { type: "object", properties: {} }
} as const

const provider = new OpenCodeProvider(true, async function (input, init) {

    const url = String(input)

    requests.push(url)

    if (url === "https://models.opencode.ai/api.json") {

        return Response.json({
            opencode: {
                models: {
                    "big-pickle": {
                        cost: { input: 0, output: 0 },
                        limit: { context: 131_072, output: 16_384 },
                        reasoning_options: [{ type: "effort", values: [null, "low", "high"] }]
                    },
                    "muse-free": {
                        cost: { input: 0, output: 0 },
                        limit: { context: 0, output: 32_000 },
                        provider: { npm: "@ai-sdk/openai" },
                        reasoning_options: [{ type: "effort", values: ["low", "medium", "high"] }]
                    },
                    paid: { cost: { input: 1, output: 1 } },
                    retired: { status: "deprecated", cost: { input: 0, output: 0 } },
                    unsupported: {
                        cost: { input: 0, output: 0 },
                        provider: { npm: "@ai-sdk/anthropic" }
                    }
                }
            }
        })
    }

    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer public")

    if (url.endsWith("/chat/completions")) {

        assert.deepEqual(JSON.parse(String(init?.body)), {
            model: "big-pickle",
            messages: [{ role: "user", content: "Hello" }],
            tools: [{ type: "function", function: tool }],
            reasoning_effort: "high",
            stream: true
        })

        return new Response([
            'data: {"choices":[{"delta":{"content":"Hello"}}]}',
            "",
            'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-time","function":{"name":"ti","arguments":"{\\""}}]}}]}',
            "",
            'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"me","arguments":"zone\\":\\"UTC\\"}"}}]}}]}',
            "",
            "data: [DONE]",
            ""
        ].join("\n"))
    }

    assert.equal(url, "https://opencode.ai/zen/v1/responses")

    assert.deepEqual(JSON.parse(String(init?.body)), {
        model: "muse-free",
        input: [{ role: "user", content: "Hello" }],
        reasoning: { effort: "low" },
        stream: true
    })

    return new Response([
        'data: {"type":"response.output_text.delta","delta":"Hi"}',
        "",
        'data: {"type":"response.output_item.done","item":{"type":"function_call","call_id":"call-docs","name":"docs","arguments":"{\\"tool\\":\\"time\\"}"}}',
        ""
    ].join("\n"))
})

const models = await provider.models()

assert.deepEqual(models.map(model => model.id), ["big-pickle", "muse-free"])

assert.equal((await provider.models())[0], models[0])

assert.equal(await models[0]!.contextWindow(), 131_072)
assert.equal(await models[1]!.contextWindow(), null)

assert.deepEqual(await models[0]!.reasoningLevels(), {
    levels: ["none", "low", "high"],
    default: null,
    required: false
})

assert.deepEqual(await models[1]!.reasoningLevels(), {
    levels: ["low", "medium", "high"],
    default: null,
    required: true
})

assert.equal(models[0]!.reasoning, null)

await assert.rejects(models[0]!.setReasoning("medium"), /does not support reasoning level/)

await models[0]!.setReasoning("high")
await models[1]!.setReasoning("low")

assert.equal(models[0]!.reasoning, "high")
assert.equal(models[1]!.reasoning, "low")

const chatEvents = []

for await (const event of models[0]!.generate({
    messages: [{ role: "user", content: "Hello" }],
    tools: [tool]
})) chatEvents.push(event)

assert.deepEqual(chatEvents, [
    { type: "text", content: "Hello" },
    { type: "tool-call", call: { id: "call-time", name: "time", input: { zone: "UTC" } } }
])

const responseEvents = []

for await (const event of models[1]!.generate({
    messages: [{ role: "user", content: "Hello" }],
    tools: []
})) responseEvents.push(event)

assert.deepEqual(responseEvents, [
    { type: "text", content: "Hi" },
    { type: "tool-call", call: { id: "call-docs", name: "docs", input: { tool: "time" } } }
])

assert.deepEqual(requests, [
    "https://models.opencode.ai/api.json",
    "https://opencode.ai/zen/v1/chat/completions",
    "https://opencode.ai/zen/v1/responses"
])
