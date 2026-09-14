import { z } from "zod"
import type {
    LLMGenerationRequest,
    LLMMessage,
    LLMModelRequest,
    LLMToolCall,
    LLMToolDefinition
} from "@server/core/llm/model"

const identity = z.string().trim().min(1)

const toolCall: z.ZodType<LLMToolCall> = z.object({
    id: identity,
    name: identity,
    input: z.unknown()
})

const message: z.ZodType<LLMMessage> = z.discriminatedUnion("role", [
    z.object({ role: z.literal("system"), content: z.string() }),
    z.object({ role: z.literal("user"), content: z.string() }),
    z.object({
        role: z.literal("assistant"),
        content: z.string(),
        toolCalls: z.array(toolCall).optional()
    }),
    z.object({
        role: z.literal("tool"),
        call: identity,
        name: identity,
        content: z.string()
    })
])

const tool: z.ZodType<LLMToolDefinition> = z.object({
    name: identity,
    description: identity,
    parameters: z.record(z.string(), z.unknown())
})

const modelRequest: z.ZodType<LLMModelRequest> = z.object({
    messages: z.array(message).min(1),
    tools: z.array(tool)
})

export const startupConfiguration = z.object({
    enabled: z.boolean()
})

export const providerRequest = z.object({
    provider: identity
})

export const providerConfiguration = z.object({
    provider: identity,
    configuration: z.unknown()
})

export const modelReference = z.object({
    provider: identity,
    model: identity
})

export const modelReasoning = modelReference.extend({
    reasoning: z.string().refine(level => level.trim().length > 0).nullable()
})

export const taskCreation = z.object({
    input: identity,
    provider: identity,
    model: identity,
    command: identity
})

export const taskRequest = z.object({
    task: identity
})

export const taskToolResponse = taskRequest.extend({
    call: identity,
    response: z.unknown()
})

export const taskHistory = z.object({
    task: identity,
    limit: z.number().int(),
    before: z.number().int().optional()
})

export const generationRequest: z.ZodType<LLMGenerationRequest> = z.object({
    generation: identity,
    provider: identity,
    model: identity,
    request: modelRequest
})
