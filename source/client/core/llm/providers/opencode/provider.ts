import type LLMProvider from "../../provider"
import type { LLMProviderRegistration, LLMProviderSource } from "../../provider"
import type { LLMModelSource } from "../../model"
import OpenCodeModel from "./model"

/** One local state and Model handle for anonymous OpenCode Zen. */
export default class OpenCodeProvider implements LLMProvider {

    public readonly identity = "opencode"
    public readonly name = "OpenCode Zen"

    private readonly retainedModels = new Map<string, OpenCodeModel>()

    public constructor(
        private readonly modelsSource: LLMModelSource,
        private readonly source: LLMProviderSource
    ) {}

    public async configured() {

        return (await this.source.state(this.identity)).configured
    }

    public async active() {

        return (await this.source.state(this.identity)).active
    }

    public state() {

        return this.source.state(this.identity)
    }

    public async activate(): Promise<void> {

        await this.source.activate(this.identity)
    }

    public async deactivate(): Promise<void> {

        await this.source.deactivate(this.identity)
    }

    public async models(): Promise<readonly OpenCodeModel[]> {

        return Object.freeze((await this.modelsSource.models())
            .filter(record => record.provider === this.identity)
            .map(record => this.model(record.id)))
    }

    public model(identity: string) {

        let model = this.retainedModels.get(identity)

        if (!model) {

            model = new OpenCodeModel(
                this,
                identity,
                request => this.modelsSource.generate(this.identity, identity, request)
            )

            this.retainedModels.set(identity, model)
        }

        return model
    }
}

export const registration: LLMProviderRegistration = Object.freeze({
    identity: "opencode",
    create: (models: LLMModelSource, source: LLMProviderSource) => new OpenCodeProvider(models, source)
})
