import defineTool from "../../define-tool"
import { interactivePromptRequestSchema } from "../../prompt-contract"
import docs from "./docs.md?raw"

/** Waits for the Client's first response to one user-facing form or HTML prompt. */
const prompt = defineTool({
    order: 7,
    docs,
    input: interactivePromptRequestSchema,
    name: "prompt",
    description: "Present a structured form or interactive HTML document to the user and wait for its result.",
    async execute(request, context) {

        return await context.client.waitAnswer(request)
    }
})

export default prompt
