import { copyFile, mkdir, rm, writeFile } from "node:fs/promises"
import { build } from "vite"

await rm("dist", { recursive: true, force: true })

await build({ configFile: "vite.config.ts", ssr: { noExternal: true } })

await build({ configFile: "vite.client.ts" })

// The System resolves Client locations beneath the Program asset root. Both
// route documents execute the same small router entry; React lazy chunks keep
// the unrequested route out of the document's module graph.
await mkdir("dist/client/agent")
await copyFile("dist/client/index.html", "dist/client/agent/index.html")

await writeFile("dist/server/package.json", JSON.stringify({ type: "module" }))
