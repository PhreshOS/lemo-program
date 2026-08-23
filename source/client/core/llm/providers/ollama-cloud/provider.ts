import type {
    OllamaCloudConfiguration,
    OllamaCloudConfigurationState
} from "@server/core/llm/providers/ollama-cloud/configuration"
import type { LLMModelRecord } from "@server/core/llm/model"
import OllamaCloudModel from "./model"
import type LLMProvider from "../../provider"

/** One local configuration and Model handle for Ollama Cloud. */
export default class OllamaCloudProvider implements LLMProvider {

    public readonly identity = "ollama-cloud"
    public readonly name = "Ollama Cloud"

    private readonly retainedModels = new Map<string, OllamaCloudModel>()

    public constructor(private readonly source: OllamaCloudSource) {}

    public async configured() {

        return (await this.source.configuration()).configured
    }

    public async configure(configuration: OllamaCloudConfiguration): Promise<void> {

        await this.source.configure(configuration)
    }

    public async removeConfiguration(): Promise<void> {

        await this.source.removeConfiguration()
    }

    public async models(): Promise<readonly OllamaCloudModel[]> {

        return Object.freeze((await this.source.models(this.identity)).map(record => this.model(record.id)))
    }

    private model(identity: string) {

        let model = this.retainedModels.get(identity)

        if (!model) {

            model = new OllamaCloudModel(
                this,
                identity,
                input => this.source.generate(this.identity, identity, input)
            )

            this.retainedModels.set(identity, model)
        }

        return model
    }
}

export interface OllamaCloudSource {
    configuration(): Promise<OllamaCloudConfigurationState>
    configure(configuration: OllamaCloudConfiguration): Promise<void>
    removeConfiguration(): Promise<void>
    models(provider: string): Promise<readonly LLMModelRecord[]>
    generate(provider: string, model: string, input: string): AsyncGenerator<string, void, unknown>
}
