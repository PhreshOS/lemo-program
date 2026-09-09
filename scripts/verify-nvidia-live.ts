import assert from "node:assert/strict"
import type { LLMModelEvent, LLMModelUsage } from "../source/server/core/llm/model"
import NvidiaProvider from "../source/server/core/llm/providers/nvidia/provider"

const apiKey = process.env.NVIDIA_API_KEY

if (!apiKey) throw new Error("Set NVIDIA_API_KEY for this explicit live test")

const provider = new NvidiaProvider({ apiKey }, true)
const models = await provider.models()
const identity = process.env.NVIDIA_TEST_MODEL ?? "nvidia/nemotron-3.5-lightning-30b-a3b"
const model = models.find(model => model.id === identity)

if (!model) throw new Error("The selected live-test Model is not in NVIDIA's available tool-capable catalog")

console.log(JSON.stringify({ model: model.id, availableModels: models.length, contextWindow: await model.contextWindow(), reasoning: await model.reasoningLevels() }))

const levels = await model.reasoningLevels()

if (levels?.levels.includes("low")) await model.setReasoning("low")

const signal = AbortSignal.timeout(90_000)
const tool = { name: "add", description: "Add two numbers. Always use this tool for addition.", parameters: { type: "object", properties: { a: { type: "number" }, b: { type: "number" } }, required: ["a", "b"], additionalProperties: false } }
const messages = [{ role: "user" as const, content: "Use the add tool to add 2 and 3. Do not calculate it yourself." }]
const first = await collect(model.generate({ messages, tools: [tool] }, { signal }))
const call = first.events.find(event => event.type === "tool-call")

assert.ok(call)
assert.equal(call.call.name, "add")
assert.deepEqual(call.call.input, { a: 2, b: 3 })

const second = await collect(model.generate({ messages: [
    ...messages,
    { role: "assistant", content: first.events.filter(event => event.type === "text").map(event => event.content).join(""), toolCalls: [call.call] },
    { role: "tool", call: call.call.id, name: call.call.name, content: "5" }
], tools: [tool] }, { signal }))

assert.ok(second.events.some(event => event.type === "text" && event.content.length > 0))
assert.equal(second.events.some(event => event.type === "tool-call"), false)

console.log(JSON.stringify({ toolRoundTrip: true, firstUsage: first.usage, secondUsage: second.usage, textChunks: second.events.length }))

async function collect(generator: AsyncGenerator<LLMModelEvent, LLMModelUsage | null, unknown>) {

    const events: LLMModelEvent[] = []

    while (true) {

        const result = await generator.next()

        if (result.done) return { events, usage: result.value }

        events.push(result.value)
    }
}
