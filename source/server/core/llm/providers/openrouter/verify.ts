import assert from "node:assert/strict"
import { OpenRouter } from "@openrouter/sdk"
import { ZodError } from "zod"
import openRouterConfiguration from "./configuration"
import OpenRouterProvider from "./provider"

const modelRequests: unknown[] = []
const generationRequests: unknown[] = []

const client = {
    models: {
        async list(request: unknown) {
            modelRequests.push(request)

            return {
                result: {
                    data: [{ id: "anthropic/claude-test" }],
                    links: { next: null },
                    totalCount: 1
                }
            }
        }
    },
    chat: {
        async send(request: unknown, options: unknown) {
            generationRequests.push({ request, options })

            return stream()
        }
    }
} as unknown as OpenRouter

const provider = new OpenRouterProvider({ apiKey: "secret" }, true, client)
const models = await provider.models()

assert.equal(models.length, 1)
assert.equal(models[0]?.id, "anthropic/claude-test")
assert.equal(models[0]?.provider, provider)
assert.equal((await provider.models())[0], models[0])
assert.deepEqual(modelRequests, [{
    limit: 1_000,
    outputModalities: "text",
    supportedParameters: "tools"
}])

const events: unknown[] = []

for await (const event of models[0]!.generate({
    messages: [{ role: "user", content: "Hello" }],
    tools: [{
        name: "time",
        description: "Return time",
        parameters: { type: "object", properties: {} }
    }]
})) events.push(event)

assert.deepEqual(events, [
    { type: "text", content: "Hello" },
    { type: "text", content: " world" },
    { type: "tool-call", call: { id: "call-time", name: "time", input: {} } }
])

assert.deepEqual(generationRequests, [{
    request: {
        chatRequest: {
            model: "anthropic/claude-test",
            messages: [{ role: "user", content: "Hello" }],
            provider: { requireParameters: true },
            stream: true,
            tools: [{
                type: "function",
                function: {
                    name: "time",
                    description: "Return time",
                    parameters: { type: "object", properties: {} }
                }
            }]
        }
    },
    options: { signal: undefined }
}])

assert.throws(() => openRouterConfiguration({}), ZodError)
assert.throws(() => openRouterConfiguration({ apiKey: "secret", host: "https://example.com" }), ZodError)

const overflowing = new OpenRouterProvider({ apiKey: "secret" }, true, {
    models: {
        async list() {
            return {
                result: {
                    data: [],
                    links: { next: "https://openrouter.ai/api/v1/models?offset=1000" },
                    totalCount: 1_001
                }
            }
        }
    }
} as unknown as OpenRouter)

await assert.rejects(overflowing.models(), /1000-Model safety bound/)

async function *stream() {

    yield {
        choices: [{ delta: { content: "Hello" } }]
    }
    yield {
        choices: [{
            delta: {
                content: " world",
                toolCalls: [{
                    index: 0,
                    id: "call-time",
                    function: { name: "ti", arguments: "{" }
                }]
            }
        }]
    }
    yield {
        choices: [{
            delta: {
                toolCalls: [{
                    index: 0,
                    function: { name: "me", arguments: "}" }
                }]
            }
        }]
    }
}
