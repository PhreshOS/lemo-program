import assert from "node:assert/strict"
import type { Server } from "@phreshos/client"
import type { OllamaCloudConfiguration } from "../source/server/core/llm/providers/ollama-cloud/configuration"
import LLMProviders from "../source/client/core/llm/providers"
import { llmServerSources } from "../source/client/core/llm/server"
import OllamaCloudProvider from "../source/client/core/llm/providers/ollama-cloud/provider"
import OpenCodeProvider from "../source/client/core/llm/providers/opencode/provider"
import OpenRouterProvider from "../source/client/core/llm/providers/openrouter/provider"

let configured = false

let active = false

let received: OllamaCloudConfiguration | null = null
const stateSubscribers = new Set<() => void>()

const providers = new LLMProviders({
    async models() {

        return active ? [
            { provider: "opencode", id: "big-pickle" },
            { provider: "ollama-cloud", id: "qwen3:latest" }
        ] : [{ provider: "opencode", id: "big-pickle" }]
    },
    async reasoning(provider, model) {

        return provider === "ollama-cloud" && model === "qwen3:latest"
            ? { levels: ["low", "medium", "high"], default: null, required: true }
            : null
    },
    async *generate() {

        yield { type: "text" as const, content: "Hello" }

        yield { type: "text" as const, content: " world" }
    }
}, {
    async open() {},
    close() {},
    subscribe(subscriber) {

        stateSubscribers.add(subscriber)

        return () => { stateSubscribers.delete(subscriber) }
    },
    async state(identity) {

        return identity === "opencode"
            ? { configured: true, active: true }
            : { configured, active }
    },
    async configure(identity, configuration) {

        assert.equal(identity, "ollama-cloud")

        received = configuration as OllamaCloudConfiguration

        configured = true
        for (const subscriber of stateSubscribers) subscriber()
    },
    async removeConfiguration(identity) {

        assert.equal(identity, "ollama-cloud")

        configured = false
        for (const subscriber of stateSubscribers) subscriber()
    },
    async activate(identity) {

        assert.equal(identity, "ollama-cloud")

        active = true
        for (const subscriber of stateSubscribers) subscriber()
    },
    async deactivate(identity) {

        assert.equal(identity, "ollama-cloud")

        active = false
        for (const subscriber of stateSubscribers) subscriber()
    }
})

assert.equal(providers.all().length, 3)

let revisions = 0

providers.subscribe(() => revisions++)

const ollamaCloud = providers.get("ollama-cloud")
const openCode = providers.get("opencode")
const openRouter = providers.get("openrouter")

assert.ok(ollamaCloud instanceof OllamaCloudProvider)
assert.ok(openCode instanceof OpenCodeProvider)
assert.ok(openRouter instanceof OpenRouterProvider)

assert.equal(await ollamaCloud.configured(), false)

assert.equal(await ollamaCloud.active(), false)

assert.equal(await openRouter.configured(), false)

assert.equal(await openRouter.active(), false)

await ollamaCloud.configure({ apiKey: "secret" })

assert.deepEqual(received, { apiKey: "secret" })

assert.equal(await ollamaCloud.configured(), true)

assert.deepEqual(await ollamaCloud.models(), [])

assert.equal(await openCode.configured(), true)

assert.equal(await openCode.active(), true)

assert.equal((await openCode.models())[0]?.id, "big-pickle")

await ollamaCloud.activate()

assert.equal(await ollamaCloud.active(), true)

const models = await ollamaCloud.models()

assert.equal(models[0]?.provider, ollamaCloud)

assert.deepEqual(await models[0]?.reasoning(), {
    levels: ["low", "medium", "high"],
    default: null,
    required: true
})

assert.equal((await ollamaCloud.models())[0], models[0])

const chunks: string[] = []

for await (const chunk of models[0]!.generate({
    messages: [{ role: "user", content: "Hello" }],
    tools: []
})) if (chunk.type === "text") chunks.push(chunk.content)

assert.deepEqual(chunks, ["Hello", " world"])

await ollamaCloud.deactivate()

assert.equal(await ollamaCloud.active(), false)

assert.deepEqual(await ollamaCloud.models(), [])

await ollamaCloud.removeConfiguration()

assert.equal(await ollamaCloud.configured(), false)
assert.equal(revisions, 4)

const reasoningAnswers: unknown[] = [
    { levels: ["low", "medium", "high"], default: "medium", required: true },
    { levels: ["low"], default: "high", required: true }
]
const modelSource = llmServerSources({
    async ask(event: string, payload: unknown) {

        assert.equal(event, "llm-model.reasoning")
        assert.deepEqual(payload, { provider: "ollama-cloud", model: "gpt-oss:latest" })

        return reasoningAnswers.shift()
    }
} as unknown as Server).models
const reasoning = await modelSource.reasoning("ollama-cloud", "gpt-oss:latest")

assert.deepEqual(reasoning, {
    levels: ["low", "medium", "high"],
    default: "medium",
    required: true
})
assert(Object.isFrozen(reasoning))
assert(Object.isFrozen(reasoning?.levels))

await assert.rejects(
    modelSource.reasoning("ollama-cloud", "gpt-oss:latest"),
    /reasoning default outside its levels/
)
