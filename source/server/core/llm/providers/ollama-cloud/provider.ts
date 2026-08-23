import type { OllamaCloudConfiguration } from "./configuration"
import OllamaCloudModel from "./model"
import type LLMProvider from "../../provider"

const host = "https://ollama.com"

type Request = (input: string | URL | globalThis.Request, init?: RequestInit) => Promise<Response>

/** Ollama Cloud's raw HTTP LLM Provider. */
export default class OllamaCloudProvider implements LLMProvider {

    public static readonly identity = "ollama-cloud"

    public readonly identity = OllamaCloudProvider.identity
    public readonly name = "Ollama Cloud"

    private readonly apiKey: string
    private readonly retainedModels = new Map<string, OllamaCloudModel>()

    public constructor(configuration: OllamaCloudConfiguration, private readonly request: Request = globalThis.fetch) {

        this.apiKey = configuration.apiKey
    }

    public async models(): Promise<readonly OllamaCloudModel[]> {

        const response = await this.fetch("/api/tags")

        const payload: unknown = await response.json()

        if (!record(payload) || !Array.isArray(payload.models)) throw new Error("Ollama Cloud returned an invalid Model list")

        return Object.freeze(payload.models.map(value => {

            if (!record(value) || typeof value.model !== "string") throw new Error("Ollama Cloud returned a Model without an identity")

            return this.model(modelIdentity(value.model))
        }))
    }

    private model(identity: string) {

        let model = this.retainedModels.get(identity)

        if (!model) {

            model = new OllamaCloudModel(this, identity, input => this.generate(identity, input))

            this.retainedModels.set(identity, model)
        }

        return model
    }

    private async *generate(model: string, input: string) {

        const response = await this.fetch("/api/generate", {
            method: "POST",
            body: JSON.stringify({ model, prompt: input, stream: true })
        })

        if (!response.body) throw new Error("Ollama Cloud returned no generation stream")

        for await (const line of lines(response.body)) {

            if (!line.trim()) continue

            const value: unknown = JSON.parse(line)

            if (!record(value)) throw new Error("Ollama Cloud returned an invalid generation event")

            if (typeof value.error === "string") throw new Error(value.error)

            if (typeof value.response !== "string") throw new Error(`Ollama Cloud Model "${model}" returned no text`)

            if (value.response) yield value.response
        }
    }

    private async fetch(path: string, init: RequestInit = {}) {

        const response = await this.request(`${host}${path}`, {
            ...init,
            headers: {
                authorization: `Bearer ${this.apiKey}`,
                "content-type": "application/json",
                ...init.headers
            }
        })

        if (!response.ok) throw new Error(await failure(response))

        return response
    }
}

async function *lines(stream: ReadableStream<Uint8Array>) {

    const reader = stream.getReader()

    const decoder = new TextDecoder()

    let buffered = ""

    try {
        while (true) {

            const { done, value } = await reader.read()

            if (done) break

            buffered += decoder.decode(value, { stream: true })

            const complete = buffered.split("\n")

            buffered = complete.pop() ?? ""

            yield* complete
        }

        buffered += decoder.decode()

        if (buffered) yield buffered
    } finally {
        reader.releaseLock()
    }
}

async function failure(response: Response) {

    const body = await response.text()

    try {
        const value: unknown = JSON.parse(body)

        if (record(value) && typeof value.error === "string") return value.error
    } catch {}

    return body.trim() || `Ollama Cloud request failed with status ${response.status}`
}

function modelIdentity(value: string) {

    const identity = value.trim()

    if (!identity) throw new Error("Ollama Cloud returned a Model without an identity")

    return identity
}

function record(value: unknown): value is Record<string, unknown> {

    return typeof value === "object" && value !== null && !Array.isArray(value)
}
