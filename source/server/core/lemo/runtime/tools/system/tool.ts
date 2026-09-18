import { executeRequestSchema } from "@phreshos/core"
import { system } from "@phreshos/server"
import defineTool from "../../define-tool"
import docs from "./docs.md?raw"
import retainSystemResult from "./retention"

/** Exposes PhreshOS through Core's shared Execute contract. */
const systemTool = defineTool({
    order: 5,
    docs,
    input: executeRequestSchema,
    name: "system",
    description: "Access PhreshOS Programs, Processes, Endpoints, and Windows through the System Execute interface.",
    execute: request => system.execute(request),
    retain: retainSystemResult
})

export default systemTool
