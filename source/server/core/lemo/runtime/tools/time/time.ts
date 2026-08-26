import { z } from "zod"
import defineTool from "../../define-tool"
import docs from "./docs.md?raw"

const input = z.object({}).strict()

/** Returns the Server's current absolute time. */
const time = defineTool({
    order: 3,
    docs,
    input,
    name: "time",
    description: "Return the current absolute time as ISO 8601 and Unix milliseconds.",
    async execute() {

        const now = new Date()

        return Object.freeze({ iso: now.toISOString(), unix: now.getTime() })
    }
})

export default time
