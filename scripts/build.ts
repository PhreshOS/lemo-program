import { rm, writeFile } from "node:fs/promises"

process.env.NODE_ENV = "production"

const { build } = await import("vite")

await rm("dist", { recursive: true, force: true })

await build({ configFile: "vite.config.ts", ssr: { noExternal: true } })

await build({ configFile: "vite.client.ts" })

await writeFile("dist/server/package.json", JSON.stringify({ type: "module" }))
