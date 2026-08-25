import { z } from "zod"
import { maximumOperationPage, maximumTaskPage } from "../../../database"
import type Tool from "../../tool"
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
        limit: z.number().int().min(1).max(maximumOperationPage).optional(),
        before: z.number().int().positive().optional()
    }).strict(),
    z.object({ action: z.literal("create"), input: z.string().trim().min(1) }).strict(),
    z.object({
        action: z.literal("send"),
        task,
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
    }).strict()
])

/** Accesses Lemo Tasks through the invocation's ordinary Lemo context. */
const tasks: Tool = {
    docs,
    definition: Object.freeze({
        name: "tasks",
        description: "Create, find, inspect, message, control, and wait for Lemo Tasks.",
        parameters: Object.freeze({
            oneOf: Object.freeze([
                variant(["action"], {
                    action: Object.freeze({ const: "list" }),
                    limit: Object.freeze({ type: "integer", minimum: 1, maximum: maximumTaskPage }),
                    cursor: Object.freeze({
                        type: "object",
                        required: Object.freeze(["id", "createdAt"]),
                        properties: Object.freeze({
                            id: Object.freeze({ type: "string" }),
                            createdAt: Object.freeze({ type: "integer", minimum: 0 })
                        }),
                        additionalProperties: false
                    }),
                    search: Object.freeze({ type: "string" }),
                    statuses: Object.freeze({
                        type: "array",
                        items: Object.freeze({
                            type: "string",
                            enum: Object.freeze(["running", "paused", "cancelled", "completed", "failed"])
                        })
                    }),
                    sourceTask: Object.freeze({ type: "string" }),
                    createdAfter: Object.freeze({ type: "integer", minimum: 0 }),
                    createdBefore: Object.freeze({ type: "integer", minimum: 0 }),
                    order: Object.freeze({ type: "string", enum: Object.freeze(["newest", "oldest"]) })
                }),
                variant(["action", "task"], {
                    action: Object.freeze({ const: "read" }),
                    task: Object.freeze({ type: "string" }),
                    limit: Object.freeze({ type: "integer", minimum: 1, maximum: maximumOperationPage }),
                    before: Object.freeze({ type: "integer", minimum: 1 })
                }),
                variant(["action", "input"], {
                    action: Object.freeze({ const: "create" }),
                    input: Object.freeze({ type: "string" })
                }),
                variant(["action", "task", "message"], {
                    action: Object.freeze({ const: "send" }),
                    task: Object.freeze({ type: "string" }),
                    message: Object.freeze({ type: "string" })
                }),
                controlVariant("pause"),
                controlVariant("continue"),
                controlVariant("cancel"),
                variant(["action"], {
                    action: Object.freeze({ const: "wait" }),
                    tasks: Object.freeze({ type: "array", items: Object.freeze({ type: "string" }) }),
                    events: Object.freeze({ type: "array", items: Object.freeze({
                        type: "string",
                        enum: Object.freeze([
                            "created",
                            "running",
                            "paused",
                            "continued",
                            "completed",
                            "failed",
                            "cancelled"
                        ])
                    }) }),
                    timeout: Object.freeze({ type: "integer", minimum: 1 })
                })
            ])
        })
    }),
    async execute(value, context) {

        const request = input.parse(value)

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
                request.limit ?? defaultOperationLimit,
                request.before
            )
        }

        if (request.action === "create") return context.tasks.create(request.input)

        if (request.action === "send") return context.tasks.send(request.task, request.message)

        if (request.action === "pause") return context.tasks.pause(request.task)

        if (request.action === "continue") return context.tasks.continue(request.task)

        if (request.action === "cancel") return context.tasks.cancel(request.task)

        return context.tasks.wait({
            tasks: request.tasks,
            events: request.events,
            timeout: request.timeout
        })
    }
}

export default tasks

function controlVariant(action: "pause" | "continue" | "cancel") {

    return variant(["action", "task"], {
        action: Object.freeze({ const: action }),
        task: Object.freeze({ type: "string" })
    })
}

function variant(required: readonly string[], properties: Readonly<Record<string, unknown>>) {

    return Object.freeze({
        type: "object",
        required: Object.freeze(required),
        properties: Object.freeze(properties),
        additionalProperties: false
    })
}

const defaultTaskLimit = 20
const defaultOperationLimit = 100
