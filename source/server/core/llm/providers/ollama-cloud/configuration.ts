import { z } from "zod"

export const ollamaCloudConfigurationSchema = z.strictObject({
    apiKey: z.string().trim().min(1, "Ollama Cloud configuration requires an API key")
})

export type OllamaCloudConfiguration = Readonly<z.infer<typeof ollamaCloudConfigurationSchema>>

export type OllamaCloudConfigurationState = Readonly<{
    configured: boolean
    active: boolean
}>

/** Validates one raw Ollama Cloud configuration from Program storage. */
export default function ollamaCloudConfiguration(value: unknown): OllamaCloudConfiguration {

    return Object.freeze(ollamaCloudConfigurationSchema.parse(value))
}
