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
}).strict()

const message: z.ZodType<LLMMessage> = z.discriminatedUnion("role", [
    z.object({ role: z.literal("system"), content: z.string() }).strict(),
    z.object({ role: z.literal("user"), content: z.string() }).strict(),
    z.object({
        role: z.literal("assistant"),
        content: z.string(),
        toolCalls: z.array(toolCall).optional()
    }).strict(),
    z.object({
        role: z.literal("tool"),
        call: identity,
        name: identity,
        content: z.string()
    }).strict()
])

const tool: z.ZodType<LLMToolDefinition> = z.object({
    name: identity,
    description: identity,
    parameters: z.record(z.string(), z.unknown())
}).strict()

const modelRequest: z.ZodType<LLMModelRequest> = z.object({
    messages: z.array(message).min(1),
    tools: z.array(tool)
}).strict()

export const startupConfiguration = z.object({
    enabled: z.boolean()
}).strict()

export const providerRequest = z.object({
    provider: identity
}).strict()

export const providerConfiguration = z.object({
    provider: identity,
    configuration: z.unknown()
}).strict()

export const modelReference = z.object({
    provider: identity,
    model: identity
}).strict()

export const modelReasoning = modelReference.extend({
    reasoning: z.string().refine(level => level.trim().length > 0).nullable()
}).strict()

export const taskCreation = z.object({
    input: identity,
    provider: identity,
    model: identity,
    command: identity
}).strict()

export const taskRequest = z.object({
    task: identity
}).strict()

export const taskHistory = z.object({
    task: identity,
    limit: z.number().int(),
    before: z.number().int().optional()
}).strict()

export const generationRequest: z.ZodType<LLMGenerationRequest> = z.object({
    generation: identity,
    provider: identity,
    model: identity,
    request: modelRequest
}).strict()
