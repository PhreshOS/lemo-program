import { z } from "zod"
import type Tool from "../../tool"
import docs from "./docs.md?raw"

const input = z.object({}).strict()

/** Returns the Server's current absolute time. */
const time: Tool = {
    order: 3,
    docs,
    definition: Object.freeze({
        name: "time",
        description: "Return the current absolute time as ISO 8601 and Unix milliseconds.",
        parameters: Object.freeze({
            type: "object",
            properties: Object.freeze({}),
            additionalProperties: false
        })
    }),
    async execute(value) {

        input.parse(value)

        const now = new Date()

        return Object.freeze({ iso: now.toISOString(), unix: now.getTime() })
    }
}

export default time
