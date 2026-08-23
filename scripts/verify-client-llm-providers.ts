import assert from "node:assert/strict"
import type { OllamaCloudConfiguration } from "../source/server/core/llm/providers/ollama-cloud/configuration"
import LLMProviders from "../source/client/core/llm/providers"

let configured = false

let received: OllamaCloudConfiguration | null = null

const providers = new LLMProviders({
    async configuration() {

        return { configured }
    },
    async configure(configuration) {

        received = configuration

        configured = true
    },
    async removeConfiguration() {

        configured = false
    },
    async models() {

        return [{ id: "qwen3:latest" }]
    },
    async *generate() {

        yield "Hello"

        yield " world"
    }
})

assert.equal(providers.all().length, 1)

assert.equal(await providers.ollamaCloud.configured(), false)

await providers.ollamaCloud.configure({ apiKey: "secret" })

assert.deepEqual(received, { apiKey: "secret" })

assert.equal(await providers.ollamaCloud.configured(), true)

const models = await providers.ollamaCloud.models()

assert.equal(models[0]?.provider, providers.ollamaCloud)

assert.equal((await providers.ollamaCloud.models())[0], models[0])

const chunks: string[] = []

for await (const chunk of models[0]!.generate("Hello")) chunks.push(chunk)

assert.deepEqual(chunks, ["Hello", " world"])

await providers.ollamaCloud.removeConfiguration()

assert.equal(await providers.ollamaCloud.configured(), false)
