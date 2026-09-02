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
            stream: true,
            stream_options: { include_usage: true }
        })

        return new Response([
            'data: {"choices":[{"delta":{"content":"Hello"}}]}',
            "",
            'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-time","function":{"name":"ti","arguments":"{\\""}}]}}]}',
            "",
            'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"me","arguments":"zone\\":\\"UTC\\"}"}}]}}]}',
            "",
            'data: {"choices":[],"usage":{"prompt_tokens":70,"completion_tokens":12,"prompt_tokens_details":{"cached_tokens":50},"completion_tokens_details":{"reasoning_tokens":4}}}',
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
        "",
        'data: {"type":"response.completed","response":{"usage":{"input_tokens":40,"output_tokens":8,"input_tokens_details":{"cached_tokens":20},"output_tokens_details":{"reasoning_tokens":3}}}}',
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

const chatGeneration = await generated(models[0]!.generate({
    messages: [{ role: "user", content: "Hello" }],
    tools: [tool]
}))

assert.deepEqual(chatGeneration.events, [
    { type: "text", content: "Hello" },
    { type: "tool-call", call: { id: "call-time", name: "time", input: { zone: "UTC" } } }
])
assert.deepEqual(chatGeneration.usage, {
    input: { tokens: 70, cachedTokens: 50 },
    output: { tokens: 12, reasoningTokens: 4 }
})

const responseGeneration = await generated(models[1]!.generate({
    messages: [{ role: "user", content: "Hello" }],
    tools: []
}))

assert.deepEqual(responseGeneration.events, [
    { type: "text", content: "Hi" },
    { type: "tool-call", call: { id: "call-docs", name: "docs", input: { tool: "time" } } }
])
assert.deepEqual(responseGeneration.usage, {
    input: { tokens: 40, cachedTokens: 20 },
    output: { tokens: 8, reasoningTokens: 3 }
})

assert.deepEqual(requests, [
    "https://models.opencode.ai/api.json",
    "https://opencode.ai/zen/v1/chat/completions",
    "https://opencode.ai/zen/v1/responses"
])

async function generated<Value, Result>(events: AsyncGenerator<Value, Result, unknown>) {

    const values: Value[] = []

    while (true) {
        const next = await events.next()

        if (next.done) return { events: values, usage: next.value }

        values.push(next.value)
    }
}
