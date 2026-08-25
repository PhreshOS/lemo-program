import { current } from "@phreshos/client"
import type { PromptEvent } from "@client/core/prompts/contract"
import type { PromptSource } from "@client/core/prompts/prompts"

/** Composes the PhreshOS Client channel into Client Core's prompt contract. */
const promptSource: PromptSource = {
    open(listener) {

        return current.subscribe("lemo.prompt.open" satisfies PromptEvent, message => listener(message.payload))
    },
    release(listener) {

        return current.subscribe("lemo.prompt.release" satisfies PromptEvent, message => listener(message.payload))
    },
    invalid(listener) {

        return current.subscribe("lemo.prompt.invalid" satisfies PromptEvent, message => listener(message.payload))
    },
    respond(value) {

        current.server.publish("lemo.prompt.response" satisfies PromptEvent, value)
    },
    ready() {

        current.server.publish("lemo.prompt.ready" satisfies PromptEvent)
    }
}

export default promptSource
