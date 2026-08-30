import { z } from "zod"
import { maximumTaskPage } from "../../../database"
import {
    defaultMemoryBudget,
    maximumMemoryBudget,
    minimumMemoryBudget
} from "../../../memory"
import defineTool from "../../define-tool"
import docs from "./docs.md?raw"

const status = z.enum(["running", "paused", "cancelled", "completed", "failed"])

const event = z.enum([
    "created",
    "running",
    "paused",
    "continued",
    "completed",
    "failed",
    "cancelled"
])

const task = z.string().trim().min(1)
const messageEvent = z.string().trim().min(1).max(256)
const tokenBudget = z.number().int().min(minimumMemoryBudget).max(maximumMemoryBudget)

const input = z.discriminatedUnion("action", [
    z.object({
        action: z.literal("list"),
        limit: z.number().int().min(1).max(maximumTaskPage).optional(),
        cursor: z.object({ id: task, createdAt: z.number().int().nonnegative() }).strict().optional(),
        search: z.string().trim().min(1).optional(),
        statuses: z.array(status).min(1).max(5).optional(),
        sourceTask: task.optional(),
        createdAfter: z.number().int().nonnegative().optional(),
        createdBefore: z.number().int().nonnegative().optional(),
        order: z.enum(["newest", "oldest"]).optional()
    }).strict(),
    z.object({
        action: z.literal("read"),
        task,
        tokens: tokenBudget.optional(),
        before: z.number().int().positive().optional()
    }).strict(),
    z.object({
        action: z.literal("read_block"),
        task,
        operation: z.string().trim().min(1),
        offset: z.number().int().nonnegative().optional(),
        tokens: tokenBudget.optional()
    }).strict(),
    z.object({ action: z.literal("create"), input: z.string().trim().min(1) }).strict(),
    z.object({
        action: z.literal("send"),
        task,
        event: messageEvent,
        message: z.string().trim().min(1)
    }).strict(),
    z.object({ action: z.literal("pause"), task }).strict(),
    z.object({ action: z.literal("continue"), task }).strict(),
    z.object({ action: z.literal("cancel"), task }).strict(),
    z.object({
        action: z.literal("wait"),
        tasks: z.array(task).min(1).max(maximumTaskPage).optional(),
        events: z.array(event).min(1).max(7).optional(),
        timeout: z.number().int().positive().optional()
    }).strict(),
    z.object({
        action: z.literal("wait_message"),
        event: messageEvent,
        timeout: z.number().int().positive().optional()
    }).strict()
])

/** Accesses Lemo Tasks through the invocation's ordinary Lemo context. */
const tasks = defineTool({
    order: 4,
    docs,
    input,
    name: "tasks",
    description: "Create, find, inspect, message, control, and coordinate Lemo Tasks.",
    async execute(request, context) {

        if (request.action === "list") {

            return context.tasks.list({
                limit: request.limit ?? defaultTaskLimit,
                cursor: request.cursor,
                search: request.search,
                statuses: request.statuses,
                sourceTask: request.sourceTask,
                createdAfter: request.createdAfter,
                createdBefore: request.createdBefore,
                order: request.order
            })
        }

        if (request.action === "read") {

            return context.tasks.read(
                request.task,
                request.tokens ?? defaultMemoryBudget,
                request.before
            )
        }

        if (request.action === "read_block") {

            return context.tasks.readBlock(
                request.task,
                request.operation,
                request.offset,
                request.tokens
            )
        }

        if (request.action === "create") return context.tasks.create(request.input)

        if (request.action === "send") return context.tasks.send(request.task, request.event, request.message)

        if (request.action === "pause") return context.tasks.pause(request.task)

        if (request.action === "continue") return context.tasks.continue(request.task)

        if (request.action === "cancel") return context.tasks.cancel(request.task)

        if (request.action === "wait") return context.tasks.wait({
            tasks: request.tasks,
            events: request.events,
            timeout: request.timeout
        })

        return context.tasks.waitMessage(request.event, request.timeout)
    }
})

export default tasks

const defaultTaskLimit = 20
