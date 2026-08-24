import type OllamaCloudModel from "@client/core/llm/providers/ollama-cloud/model"
import type OllamaCloudProvider from "@client/core/llm/providers/ollama-cloud/provider"
import type { OllamaCloudConfigurationState } from "@server/core/llm/providers/ollama-cloud/configuration"

export async function loadOllamaCloud(provider: OllamaCloudProvider): Promise<OllamaCloudSnapshot> {

    const configuration = await provider.state()

    if (!configuration.configured || !configuration.active) {

        return Object.freeze({ configuration, models: Object.freeze([]) })
    }

    try {

        return Object.freeze({ configuration, models: await provider.models() })

    } catch (cause) {

        throw new OllamaCloudLoadingError(configuration, cause)
    }
}

export class OllamaCloudLoadingError extends Error {

    public constructor(
        public readonly configuration: OllamaCloudConfigurationState,
        cause: unknown
    ) {

        super(message(cause), { cause })
    }
}

export type OllamaCloudSnapshot = Readonly<{
    configuration: OllamaCloudConfigurationState
    models: readonly OllamaCloudModel[]
}>

function message(value: unknown) {

    return value instanceof Error ? value.message : String(value)
}
