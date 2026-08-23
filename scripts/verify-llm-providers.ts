import assert from "node:assert/strict"
import type { ProgramStore } from "@phreshos/core"
import { ZodError } from "zod"
import ollamaCloudConfiguration from "../source/server/core/llm/providers/ollama-cloud/configuration"
import OllamaCloudProvider from "../source/server/core/llm/providers/ollama-cloud/provider"
import Application from "../source/server/core/application"

const values = new Map<string, unknown>()

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

assert.equal((await Application.init(store)).llmProviders.all().length, 0)

await store.set("ollama-cloud:config", { apiKey: "secret" })

const application = await Application.init(store)

assert.equal(application.llmProviders.all().length, 1)

assert.equal(application.ollamaCloudConfiguration().configured, true)

await application.removeOllamaCloudConfiguration()

assert.equal(application.ollamaCloudConfiguration().configured, false)

await application.configureOllamaCloud({ apiKey: "replacement" })

assert.deepEqual(await store.get("ollama-cloud:config"), { apiKey: "replacement" })

const requests: string[] = []

const provider = new OllamaCloudProvider({ apiKey: "secret" }, async function (input, init) {

    requests.push(String(input))

    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer secret")

    if (String(input).endsWith("/api/tags")) {

        return Response.json({ models: [{ model: "qwen3:latest" }] })
    }

    assert.equal(init?.body, JSON.stringify({ model: "qwen3:latest", prompt: "Hello", stream: true }))

    return new Response([
        JSON.stringify({ response: "Hello" }),
        JSON.stringify({ response: " world" })
    ].join("\n"))
})

const models = await provider.models()

assert.equal(models.length, 1)

assert.equal(models[0]?.id, "qwen3:latest")

assert.equal(models[0]?.provider, provider)

assert.equal((await provider.models())[0], models[0])

const chunks: string[] = []

for await (const chunk of models[0]!.generate("Hello")) chunks.push(chunk)

assert.deepEqual(chunks, ["Hello", " world"])

assert.deepEqual(requests, [
    "https://ollama.com/api/tags",
    "https://ollama.com/api/tags",
    "https://ollama.com/api/generate"
])

assert.throws(() => ollamaCloudConfiguration({}), ZodError)

assert.throws(() => ollamaCloudConfiguration({ apiKey: "secret", host: "https://example.com" }), ZodError)
