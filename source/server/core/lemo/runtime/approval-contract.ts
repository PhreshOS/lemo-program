import { z } from "zod"

export const approvalRequestSchema = z.strictObject({
    type: z.literal("approval"),
    title: z.string().trim().min(1).max(200),
    content: z.string().trim().min(1).max(4_000)
})

export const approvalResponseSchema = z.discriminatedUnion("type", [
    z.strictObject({ type: z.literal("approved") }),
    z.strictObject({ type: z.literal("rejected") })
])

export type ApprovalRequest = Readonly<z.infer<typeof approvalRequestSchema>>
export type ApprovalResponse = Readonly<z.infer<typeof approvalResponseSchema>>
