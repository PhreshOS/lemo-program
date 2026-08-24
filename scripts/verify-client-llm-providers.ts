import assert from "node:assert/strict"
import type { OllamaCloudConfiguration } from "../source/server/core/llm/providers/ollama-cloud/configuration"
import LLMProviders from "../source/client/core/llm/providers"
import OllamaCloudProvider from "../source/client/core/llm/providers/ollama-cloud/provider"
import OpenCodeProvider from "../source/client/core/llm/providers/opencode/provider"

let configured = false

let active = false

let received: OllamaCloudConfiguration | null = null

const providers = new LLMProviders({
    async models() {

        return active ? [
            { provider: "opencode", id: "big-pickle" },
            { provider: "ollama-cloud", id: "qwen3:latest" }
        ] : [{ provider: "opencode", id: "big-pickle" }]
    },
    async *generate() {

        yield { type: "text" as const, content: "Hello" }

        yield { type: "text" as const, content: " world" }
    }
}, {
    async state(identity) {

        return identity === "opencode"
            ? { configured: true, active: true }
            : { configured, active }
    },
    async configure(identity, configuration) {

        assert.equal(identity, "ollama-cloud")

        received = configuration as OllamaCloudConfiguration

        configured = true
    },
    async removeConfiguration(identity) {

        assert.equal(identity, "ollama-cloud")

        configured = false
    },
    async activate(identity) {

        assert.equal(identity, "ollama-cloud")

        active = true
    },
    async deactivate(identity) {

        assert.equal(identity, "ollama-cloud")

        active = false
    }
})

assert.equal(providers.all().length, 2)

const ollamaCloud = providers.get("ollama-cloud")
const openCode = providers.get("opencode")

assert.ok(ollamaCloud instanceof OllamaCloudProvider)
assert.ok(openCode instanceof OpenCodeProvider)

assert.equal(await ollamaCloud.configured(), false)

assert.equal(await ollamaCloud.active(), false)

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
