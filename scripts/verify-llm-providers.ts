import assert from "node:assert/strict"
import { DatabaseSync } from "node:sqlite"
import type { ProgramStore } from "@phreshos/core"
import { ZodError } from "zod"
import ollamaCloudConfiguration from "../source/server/core/llm/providers/ollama-cloud/configuration"
import OllamaCloudProvider from "../source/server/core/llm/providers/ollama-cloud/provider"
import type LLMProvider from "../source/server/core/llm/provider"
import LLMProviders from "../source/server/core/llm/providers"
import Application from "../source/server/core/application"

const values = new Map<string, unknown>()
const database = new DatabaseSync(":memory:")

const store: ProgramStore = {
    async get<Value = unknown>(key: string): Promise<Value | undefined> {

        return values.get(key) as Value | undefined
    },
    async set(key, value) {

        values.set(key, value)

        return true
    },
    async delete(key) {

        const keys = Array.isArray(key) ? key : [key]

        return keys.map(value => values.delete(value)).some(Boolean)
    },
    async has(key) {

        return values.has(key)
    },
    async clear() {

        values.clear()
    }
}

const unconfigured = await Application.init(store, database)

assert.equal(unconfigured.llmProviders.all().length, 0)

assert.deepEqual(unconfigured.ollamaCloudConfiguration(), { configured: false, active: true })

await store.set("ollama-cloud:config", { apiKey: "secret" })

const application = await Application.init(store, database)

assert.equal(application.llmProviders.all().length, 1)

assert.deepEqual(application.ollamaCloudConfiguration(), { configured: true, active: true })

assert.equal(await store.get("ollama-cloud:active"), true)

await application.removeOllamaCloudConfiguration()

assert.equal(application.ollamaCloudConfiguration().configured, false)

await application.configureOllamaCloud({ apiKey: "replacement" })

assert.deepEqual(await store.get("ollama-cloud:config"), { apiKey: "replacement" })

await application.deactivateOllamaCloud()

assert.deepEqual(application.ollamaCloudConfiguration(), { configured: true, active: false })

assert.deepEqual(await application.modelRecords(), [])

await application.activateOllamaCloud()

assert.deepEqual(application.ollamaCloudConfiguration(), { configured: true, active: true })

const requests: string[] = []
const tool = {
    name: "time",
    description: "Return time",
    parameters: { type: "object", properties: {} }
} as const

const provider = new OllamaCloudProvider({ apiKey: "secret" }, true, async function (input, init) {

    requests.push(String(input))

    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer secret")

    if (String(input).endsWith("/api/tags")) {

        return Response.json({ models: [{ model: "qwen3:latest" }] })
    }

    assert.equal(init?.body, JSON.stringify({
        model: "qwen3:latest",
        messages: [{ role: "user", content: "Hello" }],
        tools: [{ type: "function", function: tool }],
        stream: true
    }))

    return new Response([
        JSON.stringify({ message: { role: "assistant", content: "Hello" } }),
        JSON.stringify({ message: { role: "assistant", content: " world" } }),
        JSON.stringify({
            message: {
                role: "assistant",
                content: "",
                tool_calls: [{
                    id: "call-time",
                    type: "function",
                    function: { name: "time", arguments: {} }
                }]
            }
        })
    ].join("\n"))
})

const models = await provider.models()

assert.equal(models.length, 1)

assert.equal(models[0]?.id, "qwen3:latest")

assert.equal(models[0]?.provider, provider)

assert.equal((await provider.models())[0], models[0])

const chunks: string[] = []
const calls: unknown[] = []

for await (const chunk of models[0]!.generate({
    messages: [{ role: "user", content: "Hello" }],
    tools: [tool]
})) {

    if (chunk.type === "text") chunks.push(chunk.content)
    else calls.push(chunk.call)
}

assert.deepEqual(chunks, ["Hello", " world"])

assert.deepEqual(calls, [{ id: "call-time", name: "time", input: {} }])

assert.deepEqual(requests, [
    "https://ollama.com/api/tags",
    "https://ollama.com/api/tags",
    "https://ollama.com/api/chat"
])

assert.throws(() => ollamaCloudConfiguration({}), ZodError)

assert.throws(() => ollamaCloudConfiguration({ apiKey: "secret", host: "https://example.com" }), ZodError)

let inactiveCalled = false

const inactiveProvider: LLMProvider = {
    identity: "inactive",
    name: "Inactive",
    active: false,
    async models() {

        inactiveCalled = true

        throw new Error("Inactive Provider was called")
    }
}

assert.deepEqual(await new LLMProviders([inactiveProvider]).models(), [])

assert.equal(inactiveCalled, false)

const failingProvider: LLMProvider = {
    identity: "failing",
    name: "Failing",
    active: true,
    async models() {

        throw new Error("Model loading failed")
    }
}

await assert.rejects(new LLMProviders([inactiveProvider, failingProvider]).models(), /Model loading failed/)

assert.equal(inactiveCalled, false)

database.close()
