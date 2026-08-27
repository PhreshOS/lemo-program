import { z } from "zod"
import defineTool from "../../define-tool"
import docs from "./docs.md?raw"
import TextFiles, {
    maximumDirectoryPage,
    maximumReadLines
} from "./internal/text-files"

const path = z.string().min(1).max(4_096)
    .describe("Absolute path, ~/ path, or path relative to the user's home directory.")
const text = z.string().max(1_000_000)
const change = z.object({
    oldText: z.string().min(1).max(100_000),
    newText: z.string().max(100_000),
    occurrence: z.number().int().positive().optional()
}).strict()

const input = z.discriminatedUnion("action", [
    z.object({
        action: z.literal("list"),
        path: path.optional(),
        cursor: z.number().int().nonnegative().optional(),
        limit: z.number().int().positive().max(maximumDirectoryPage).optional()
    }).strict(),
    z.object({ action: z.literal("inspect"), path }).strict(),
    z.object({
        action: z.literal("read"),
        path,
        startLine: z.number().int().positive().optional(),
        lineCount: z.number().int().positive().max(maximumReadLines).optional()
    }).strict(),
    z.object({
        action: z.literal("create"),
        path,
        content: text,
        parents: z.boolean().optional()
    }).strict(),
    z.object({
        action: z.literal("write"),
        path,
        revision: z.string().min(1).describe("Exact revision returned by the latest read."),
        content: text
    }).strict(),
    z.object({
        action: z.literal("edit"),
        path,
        revision: z.string().min(1).describe("Exact revision returned by the latest read."),
        changes: z.array(change).min(1).max(32)
    }).strict(),
    z.object({ action: z.literal("mkdir"), path }).strict(),
    z.object({
        action: z.literal("delete"),
        path,
        recursive: z.boolean().optional().describe("Set true to delete a non-empty directory tree.")
    }).strict(),
    z.object({
        action: z.literal("copy"),
        source: path,
        destination: path,
        parents: z.boolean().optional()
    }).strict()
])

const filesystem = new TextFiles()

/** Manages UTF-8 files through Lemo's own bounded filesystem contract. */
const files = defineTool({
    order: 10,
    docs,
    input,
    name: "files",
    description: "Inspect and manage UTF-8 files and directories, starting from the user's home directory.",
    observation: request => request.action === "list" || request.action === "inspect" || request.action === "read",
    approval(request) {
        if (request.action !== "delete") return null

        const target = filesystem.path(request.path)

        return Object.freeze({
            title: "Approve permanent deletion",
            content: request.recursive
                ? `Lemo wants to permanently delete "${target}" and everything inside it.`
                : `Lemo wants to permanently delete "${target}".`
        })
    },
    async execute(request, context) {

        if (request.action === "list") {
            return filesystem.list(
                request.path ?? "~",
                request.cursor ?? 0,
                request.limit ?? 50,
                context.invocation.signal
            )
        }

        if (request.action === "inspect") return filesystem.inspect(request.path)

        if (request.action === "read") {
            return filesystem.read(request.path, request.startLine ?? 1, request.lineCount ?? 200)
        }

        let result: unknown
        let description: string

        if (request.action === "create") {
            result = await filesystem.create(request.path, request.content, request.parents ?? true)
            description = `Created UTF-8 file "${request.path}".`
        } else if (request.action === "write") {
            result = await filesystem.write(request.path, request.revision, request.content)
            description = `Replaced UTF-8 file "${request.path}".`
        } else if (request.action === "edit") {
            result = await filesystem.edit(
                request.path,
                request.revision,
                request.changes
            )
            description = `Edited UTF-8 file "${request.path}" with ${request.changes.length} exact change(s).`
        } else if (request.action === "mkdir") {
            result = await filesystem.directory(request.path)
            description = `Created directory path "${request.path}".`
        } else if (request.action === "delete") {
            result = await filesystem.delete(request.path, request.recursive ?? false)
            description = `Permanently deleted "${request.path}".`
        } else {
            result = await filesystem.copy(
                request.source,
                request.destination,
                request.parents ?? true,
                context.invocation.signal
            )
            description = `Copied UTF-8 content from "${request.source}" to "${request.destination}".`
        }

        await context.memory.record({
            content: description,
            source: `filesystem:${request.action === "copy" ? request.destination : request.path}`,
            method: `files.${request.action}`
        })

        return result
    }
})

export default files
