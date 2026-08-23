import { current } from "@phreshos/client"

export default class Application {

    public async name(): Promise<string> {

        return await current.server.ask<string>("application.name")
    }
}
