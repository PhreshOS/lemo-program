import { current } from "@phreshos/server"
import Application from "@server/core/application"

export default async function view() {

    const application = new Application()

    current.answer("application.name", () => application.name())
}
