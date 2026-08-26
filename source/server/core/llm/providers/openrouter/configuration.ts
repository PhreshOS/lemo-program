import { z } from "zod"

export const openRouterConfigurationSchema = z.strictObject({
    apiKey: z.string().trim().min(1, "OpenRouter configuration requires an API key")
})

export type OpenRouterConfiguration = Readonly<z.infer<typeof openRouterConfigurationSchema>>

/** Validates one raw OpenRouter configuration from Program storage. */
export default function openRouterConfiguration(value: unknown): OpenRouterConfiguration {

    return Object.freeze(openRouterConfigurationSchema.parse(value))
}
