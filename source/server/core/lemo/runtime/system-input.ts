import type { ClientLaunch, Launch, Position, ServerLaunch, Size } from "@phreshos/core"
import { isRelativeValue, layers } from "@phreshos/core"
import { z } from "zod"

/** Tool JSON syntax covers every field of the Core contract it consumes. */
type Shape<Value> = { [Key in keyof Value]-?: z.ZodType<Value[Key]> }

export const identity = z.string().trim().min(1)
const value = z.union([z.number(), z.string().trim().min(1)])
    .refine(isRelativeValue, "Expected finite pixels or a workspace-relative expression")
    .describe("Absolute pixels as a number, or a workspace-relative expression such as 50% or 1/2.")

export const position = z.object({ x: value, y: value } satisfies Shape<Position>).strict()
export const size = z.object({ width: value, height: value } satisfies Shape<Size>).strict()
export const serverLaunch = z.object({
    service: z.boolean().optional()
} satisfies Shape<ServerLaunch>).strict()
export const clientLaunch = z.object({
    service: z.boolean().optional(),
    title: z.string().optional(),
    size: size.optional(),
    position: position.optional(),
    layer: z.enum(layers).optional(),
    minimize: z.boolean().optional(),
    maximize: z.boolean().optional()
} satisfies Shape<ClientLaunch>).strict()
export const launch = z.object({
    name: identity.optional(),
    replace: z.boolean().optional().describe("Replace the existing Process with this Program-local name. Requires name."),
    server: z.union([z.boolean(), serverLaunch]).optional(),
    client: z.union([z.boolean(), clientLaunch]).optional(),
    options: z.record(z.string(), z.string()).optional()
} satisfies Shape<Launch>).strict().refine(value => value.replace === undefined || value.name !== undefined, "Process replacement requires a name")
