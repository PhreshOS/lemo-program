import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import config from "../phresh.config"
import metadata from "../metadata.json" with { type: "json" }
import manifest from "../package.json" with { type: "json" }

assert.equal(metadata.schema, 1)
assert.equal(metadata.identity, config.identity)
assert.equal(metadata.version, config.version)
assert.equal(metadata.version, manifest.version)
assert.equal(typeof metadata.name, "string")
assert(metadata.name.trim().length > 0)
assert.equal(typeof metadata.description, "string")
assert(metadata.description.trim().length > 0)
assert.equal(metadata.icon, "icon.png")
assert(existsSync(metadata.icon))
assert(Array.isArray(metadata.categories))
assert(Array.isArray(metadata.keywords))
new URL(metadata.website)
