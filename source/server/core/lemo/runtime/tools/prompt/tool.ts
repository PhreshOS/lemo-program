import defineTool from "../../define-tool"
import { interactivePromptRequestSchema, parsePromptResponse } from "./contract"
import docs from "./docs.md?raw"

/** Waits for the Client's first response to one user-facing form or HTML prompt. */
const prompt = defineTool({
    order: 7,
    docs,
    input: interactivePromptRequestSchema,
    name: "prompt",
    description: "Present a structured form or interactive HTML document to the user and wait for its result.",
    async execute(request, context) {

        const response = await context.invocation.wait(value => parsePromptResponse(request, value))

        if (response.type === "failed") throw new Error(response.error)

        return response
    }
})

export default prompt
