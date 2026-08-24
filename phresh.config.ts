import { defineConfig } from "@phreshos/core"

export default defineConfig({
    identity: "lemo",
    name: "Lemo",
    description: "The official PhreshOS agent.",
    version: "0.1.1",
    buildCommand: "vite-node scripts/build.ts",
    server: {
        location: "dist/server",
        startCommand: "node main.js",
        development: {
            startCommand: "vite-node source/server/main.ts"
        }
    },
    client: {
        location: "dist/client",
        title: "Lemo",
        size: { width: 600, height: 500 },
        development: {
            url: "http://localhost:5250/",
            startCommand: "vite dev --config vite.client.ts"
        }
    }
})
