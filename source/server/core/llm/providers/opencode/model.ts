import type LLMModel from "../../model"
import type { LLMModelEvent, LLMModelExecution, LLMModelRequest } from "../../model"
import type OpenCodeProvider from "./provider"

export type OpenCodeProtocol = "chat-completions" | "responses"

/** One anonymous OpenCode Zen Model. */
export default class OpenCodeModel implements LLMModel {

    public constructor(
        public readonly provider: OpenCodeProvider,
        public readonly id: string,
        public readonly protocol: OpenCodeProtocol,
        private readonly generateEvents: (
            request: LLMModelRequest,
            execution?: LLMModelExecution
        ) => AsyncGenerator<LLMModelEvent, void, unknown>
    ) {}

    public generate(request: LLMModelRequest, execution?: LLMModelExecution) {

        return this.generateEvents(request, execution)
    }
}
