import { createHash } from "node:crypto"
import { z } from "zod"

const endpointContractPayload = z.object({
    task: z.string().uuid(),
    program: z.string().min(1),
    endpoint: z.enum(["server", "client"]),
    documentation: z.string().length(64)
}).strict()

const servicePayload = z.object({
    contract: z.string().min(1),
    name: z.string().min(1)
}).strict()

export type EndpointContract = z.infer<typeof endpointContractPayload>

/** Issues a Task-bound identity for one exact version of Endpoint documentation. */
export function issueEndpointContract(value: Readonly<{
    task: string
    program: string
    endpoint: "server" | "client"
    documentation: string
}>) {

    return encode("endpoint-contract", {
        task: value.task,
        program: value.program,
        endpoint: value.endpoint,
        documentation: digest(value.documentation)
    })
}

/** Reads the Endpoint coordinates carried by a documented contract identity. */
export function readEndpointContract(identity: string): EndpointContract {

    return Object.freeze(endpointContractPayload.parse(decode(identity, "endpoint-contract")))
}

/** Verifies that an Endpoint contract belongs to this Task and current documentation. */
export function verifyEndpointContract(
    identity: string,
    task: string,
    documentation: string
): EndpointContract {

    const contract = readEndpointContract(identity)

    if (contract.task !== task) throw new Error("The Endpoint contract belongs to another Task")

    if (contract.documentation !== digest(documentation)) {

        throw new Error("The Endpoint Service documentation changed; read it again before connecting")
    }

    return contract
}

/** Issues a durable handle for one Service authorized by a documented Endpoint contract. */
export function issueServiceAccess(contract: string, name: string) {

    return encode("service", { contract, name })
}

/** Reads the documented Endpoint contract and name carried by a Service handle. */
export function readServiceAccess(identity: string): Readonly<{
    contract: string
    name: string
}> {

    return Object.freeze(servicePayload.parse(decode(identity, "service")))
}

function digest(value: string) {

    return createHash("sha256").update(value).digest("hex")
}

function encode(kind: string, value: unknown) {

    return `${kind}:${Buffer.from(JSON.stringify(value)).toString("base64url")}`
}

function decode(identity: string, kind: string) {

    const prefix = `${kind}:`

    if (!identity.startsWith(prefix)) throw new Error(`Invalid ${kind} identity`)

    try {
        return JSON.parse(Buffer.from(identity.slice(prefix.length), "base64url").toString("utf8"))
    } catch {
        throw new Error(`Invalid ${kind} identity`)
    }
}
