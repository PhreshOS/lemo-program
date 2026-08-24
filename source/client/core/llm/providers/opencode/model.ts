import type LLMModel from "../../model"
import type { LLMModelEvent, LLMModelRequest } from "@server/core/llm/model"
import type OpenCodeProvider from "./provider"

/** One local OpenCode Zen Model handle. */
export default class OpenCodeModel implements LLMModel {

    public constructor(
        public readonly provider: OpenCodeProvider,
        public readonly id: string,
        private readonly generateEvents: (request: LLMModelRequest) => AsyncGenerator<LLMModelEvent, void, unknown>
    ) {}

    public generate(request: LLMModelRequest) {

        return this.generateEvents(request)
    }
}
