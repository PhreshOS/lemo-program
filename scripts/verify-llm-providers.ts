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
const client = {
    publish() {},
    subscribe() { return () => {} }
}
let agentStarted = false
const environment = {
    identity: "lemo",
    startup: {
        async get() { return null },
        async enable() {},
        async disable() {}
    },
    client: {
        async exists() { return agentStarted },
        async start(overrides?: { location?: string }) {

            assert.deepEqual(overrides, { location: "/agent" })

            agentStarted = true
        }
    }
}

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

const unconfigured = await Application.init(store, database, client, environment)

assert.equal(agentStarted, false)

await unconfigured.start()

assert.equal(agentStarted, true)

assert.equal(unconfigured.llmProviders.all().length, 1)

assert.deepEqual(unconfigured.llmProviderState("ollama-cloud"), { configured: false, active: true })

assert.deepEqual(unconfigured.llmProviderState("opencode"), { configured: true, active: true })

assert.deepEqual(unconfigured.llmProviderState("openrouter"), { configured: false, active: true })

assert.equal(await store.get("opencode:active"), true)

assert.equal(await store.get("openrouter:active"), true)

await store.set("ollama-cloud:config", { apiKey: "secret" })

const application = await Application.init(store, database, client, environment)
const applicationEvents: unknown[] = []

application.subscribe(event => applicationEvents.push(event))

assert.equal(application.llmProviders.all().length, 2)

assert.deepEqual(application.llmProviderState("ollama-cloud"), { configured: true, active: true })

assert.equal(await store.get("ollama-cloud:active"), true)

await application.removeLLMProviderConfiguration("ollama-cloud")

assert.equal(application.llmProviderState("ollama-cloud").configured, false)

await application.configureLLMProvider("ollama-cloud", { apiKey: "replacement" })

assert.deepEqual(await store.get("ollama-cloud:config"), { apiKey: "replacement" })

await application.deactivateLLMProvider("ollama-cloud")

await application.deactivateLLMProvider("opencode")

assert.deepEqual(application.llmProviderState("ollama-cloud"), { configured: true, active: false })

assert.deepEqual(await application.modelRecords(), [])

assert.deepEqual(application.llmProviderState("opencode"), { configured: true, active: false })

await application.activateLLMProvider("ollama-cloud")

await application.activateLLMProvider("opencode")

assert.deepEqual(application.llmProviderState("ollama-cloud"), { configured: true, active: true })

await application.configureStartup(true)

assert(applicationEvents.some(event => (
    typeof event === "object"
    && event !== null
    && (event as { type?: unknown }).type === "llm-provider.changed"
)))
assert.deepEqual(applicationEvents.at(-1), {
    type: "manager.startup.changed",
    enabled: true
})

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

        return Response.json({ models: [
            { model: "qwen3:latest" },
            { model: "gpt-oss:latest" }
        ] })
    }

    if (String(input).endsWith("/api/show")) {

        const body = JSON.parse(String(init?.body)) as { model: string }

        return body.model === "gpt-oss:latest"
            ? Response.json({
                capabilities: ["thinking"],
                details: { family: "gptoss", families: ["gptoss"] },
                model_info: { "gptoss.context_length": 131_072 }
            })
            : Response.json({
                capabilities: ["thinking"],
                details: { family: "qwen3", families: ["qwen3"] },
                model_info: { "qwen3.context_length": 32_768 }
            })
    }

    assert.equal(init?.body, JSON.stringify({
        model: "gpt-oss:latest",
        messages: [{ role: "user", content: "Hello" }],
        tools: [{ type: "function", function: tool }],
        think: "high",
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

assert.equal(models.length, 2)

assert.equal(models[0]?.id, "qwen3:latest")

assert.equal(models[0]?.provider, provider)

assert.equal((await provider.models())[0], models[0])

assert.equal(await models[0]?.contextWindow(), 32_768)

assert.equal(await models[0]?.reasoningLevels(), null)

assert.equal(await models[0]?.reasoningLevels(), null)

assert.deepEqual(await models[1]?.reasoningLevels(), {
    levels: ["low", "medium", "high"],
    default: null,
    required: true
})

assert.equal(await models[1]?.contextWindow(), 131_072)

assert.equal(models[1]?.reasoning, null)

await assert.rejects(models[0]!.setReasoning("high"), /no selectable reasoning levels/)
await assert.rejects(models[1]!.setReasoning("extreme"), /does not support reasoning level/)

await models[1]!.setReasoning("high")

assert.equal(models[1]?.reasoning, "high")

assert.deepEqual(await models[1]?.reasoningLevels(), {
    levels: ["low", "medium", "high"],
    default: null,
    required: true
})

const chunks: string[] = []
const calls: unknown[] = []

for await (const chunk of models[1]!.generate({
    messages: [{ role: "user", content: "Hello" }],
    tools: [tool]
})) {

    if (chunk.type === "text") chunks.push(chunk.content)
    else calls.push(chunk.call)
}

assert.deepEqual(chunks, ["Hello", " world"])

assert.deepEqual(calls, [{ id: "call-time", name: "time", input: {} }])

await models[1]!.setReasoning(null)

assert.equal(models[1]?.reasoning, null)

assert.deepEqual(requests, [
    "https://ollama.com/api/tags",
    "https://ollama.com/api/tags",
    "https://ollama.com/api/show",
    "https://ollama.com/api/show",
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

const providerVerifications = import.meta.glob<true, string, () => Promise<unknown>>(
    "../source/server/core/llm/providers/*/verify.ts"
)

for (const verify of Object.values(providerVerifications)) await verify()

database.close()
