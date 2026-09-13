import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
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
