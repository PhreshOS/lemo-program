import type LLMModel from "@client/core/llm/model"
import type LLMProviders from "@client/core/llm/providers"
import type { PromiseWithDependencies } from "@libs/react-promise"
import { Fragment, type ComponentType } from "react"

export type LLMProviderViewProperties = Readonly<{
    providers: LLMProviders
    models: PromiseWithDependencies<readonly LLMModel[]>
}>

const modules = import.meta.glob<{
    identity: string
    default: ComponentType<LLMProviderViewProperties>
}>("./llm-providers/*.tsx", { eager: true })

const integrations = Object.values(modules)
    .sort((left, right) => left.identity.localeCompare(right.identity))

/** Renders every View integration owned by a concrete LLM Provider. */
export default function LLMProviderViews(properties: LLMProviderViewProperties) {

    return integrations.map(integration => <Fragment key={integration.identity}>
        <integration.default {...properties} />
    </Fragment>)
}
