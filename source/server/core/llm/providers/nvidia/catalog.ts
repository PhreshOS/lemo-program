import { z } from "zod"
import type { LLMReasoningLevels } from "../../model"

export const reasoningEffort = z.enum(["none", "minimal", "low", "medium", "high", "xhigh", "max"])

const metadataSchema = z.object({
    tool_call: z.boolean().optional(),
    status: z.string().optional(),
    modalities: z.object({ input: z.array(z.string()), output: z.array(z.string()) }).optional(),
    limit: z.object({ context: z.number().int().nonnegative().optional() }).optional(),
    reasoning_options: z.array(z.object({ type: z.string(), values: z.array(z.string().nullable()).optional() })).optional()
})

const catalogSchema = z.object({ nvidia: z.object({ models: z.record(z.string(), metadataSchema) }) })

/** Models.dev supplies NVIDIA-specific capabilities; NVIDIA supplies availability. */
export async function nvidiaCatalog(request: typeof globalThis.fetch): Promise<ReadonlyMap<string, NvidiaModelMetadata>> {

    const response = await request("https://models.dev/api.json", { signal: AbortSignal.timeout(30_000) })

    if (!response.ok) throw new Error(`NVIDIA capability catalog failed with status ${response.status}`)

    const catalog = catalogSchema.parse(await response.json())
    const models = new Map<string, NvidiaModelMetadata>()

    for (const [identity, metadata] of Object.entries(catalog.nvidia.models)) {

        if (metadata.status === "deprecated" || metadata.tool_call !== true
            || !metadata.modalities?.input.includes("text") || !metadata.modalities.output.includes("text")) continue

        const effort = metadata.reasoning_options?.find(option => option.type === "effort")
        const values = effort?.values?.map(value => value ?? "none")
        const supported = values && values.length > 0 && values.every(value => reasoningEffort.safeParse(value).success)

        models.set(identity, Object.freeze({
            contextWindow: metadata.limit?.context || null,
            reasoning: supported ? Object.freeze({ levels: Object.freeze([...new Set(values)]), default: null, required: !values.includes("none") }) : null
        }))
    }

    return models
}

export type NvidiaModelMetadata = Readonly<{
    contextWindow: number | null
    reasoning: LLMReasoningLevels | null
}>
