import { defineConfig } from "vitest/config"
import { resolve } from "node:path"
import { realpathSync } from "node:fs"

const linkedReactPackages = ["@phreshos/react", "@phreshos/react-ui"]
  .map(packageName => realpathSync(resolve(import.meta.dirname, "node_modules", packageName)))
  .map(path => path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))

const linkedReactPackage = new RegExp(`^(?:${linkedReactPackages.join("|")})(?:/|$)`)

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    dedupe: ["react", "react-dom"],
    alias: {
      react: resolve(import.meta.dirname, "node_modules/react"),
      "react-dom": resolve(import.meta.dirname, "node_modules/react-dom")
    }
  },
  test: {
    // The UI contract test renders a linked SDK. Inline its dependency graph
    // so every React import passes through the renderer aliases above.
    server: { deps: { inline: [linkedReactPackage] } },
    pool: "forks",
    maxWorkers: 2,
    projects: [
      {
        extends: true,
        test: {
          name: "default",
          include: [
            "tests/**/*.test.{ts,tsx,mjs}"
          ],
          exclude: [
            "tests/**/*.platform.test.*",
            "tests/**/*.live.test.*"
          ],
          environment: "node",
          testTimeout: 30000
        }
      },
      {
        extends: true,
        test: {
          name: "live",
          include: [
            "tests/**/*.live.test.{ts,tsx,mjs}"
          ],
          testTimeout: 120000
        }
      }
    ]
  }
})
