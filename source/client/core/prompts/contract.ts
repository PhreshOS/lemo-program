import { z } from "zod"

export type PromptEvent =
    | "lemo.prompt.open"
    | "lemo.prompt.release"
    | "lemo.prompt.response"
    | "lemo.prompt.ready"

export const promptRecordSchema = z.strictObject({
    id: z.string().trim().min(1),
    task: z.string().trim().min(1),
    call: z.string().trim().min(1),
    content: z.string().trim().min(1).max(4_000),
    createdAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().nonnegative()
})

export const promptReleaseSchema = z.strictObject({
    id: z.string().trim().min(1),
    reason: z.enum(["answered", "timeout", "cancelled"])
})

export const promptResponseSchema = z.strictObject({
    id: z.string().trim().min(1),
    content: z.string().trim().min(1).max(4_000)
})

export const promptReadySchema = z.strictObject({
    client: z.string().trim().min(1)
})

export type PromptRecord = Readonly<z.infer<typeof promptRecordSchema>>
export type PromptRelease = Readonly<z.infer<typeof promptReleaseSchema>>
export type PromptResponse = Readonly<z.infer<typeof promptResponseSchema>>
export type PromptReady = Readonly<z.infer<typeof promptReadySchema>>
