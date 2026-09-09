import { z } from "zod"

export const nvidiaConfigurationSchema = z.strictObject({
    apiKey: z.string().trim().min(1, "NVIDIA configuration requires an API key")
})

export type NvidiaConfiguration = Readonly<z.infer<typeof nvidiaConfigurationSchema>>

/** Validates one raw Nvidia configuration from Program storage. */
export default function nvidiaConfiguration(value: unknown): NvidiaConfiguration {

    return Object.freeze(nvidiaConfigurationSchema.parse(value))
}
