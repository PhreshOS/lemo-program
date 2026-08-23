import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import config from "../phresh.config"
import manifest from "../package.json" with { type: "json" }

assert.equal(config.identity, "lemo")

assert.equal(config.name, "Lemo")

assert.equal(config.version, manifest.version)

assert.equal(config.server?.location, "dist/server")

assert.equal(config.server?.startCommand, "node main.js")

assert.equal(config.client?.location, "dist/client")

assert.deepEqual(config.client?.size, { width: 600, height: 500 })

assert(readFileSync("dist/client/index.html", "utf8").length > 0)

assert(readFileSync("dist/server/main.js", "utf8").length > 0)

const serverManifest = JSON.parse(readFileSync("dist/server/package.json", "utf8")) as Record<string, unknown>

assert.deepEqual(serverManifest, { type: "module" })
