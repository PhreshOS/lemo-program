import { z } from "zod"

const url = z.url({ protocol: /^https?$/ }).max(8192).refine(value => {

    const address = new URL(value)

    return !address.username && !address.password
}, "Web URLs must not contain credentials")

export const webInput = z.discriminatedUnion("action", [
    z.object({
        action: z.literal("search"),
        query: z.string().trim().min(1).max(4000),
        count: z.number().int().min(1).max(10).default(5)
    }).strict(),
    z.object({
        action: z.literal("read"),
        url,
        maxCharacters: z.number().int().min(1).max(100_000).default(20_000)
    }).strict()
])

export const webResult = z.object({
    request: webInput,
    provider: z.literal("exa"),
    content: z.string()
}).strict()

export type WebRequest = z.output<typeof webInput>

export type WebResult = z.output<typeof webResult>
