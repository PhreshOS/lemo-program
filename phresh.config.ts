import { defineConfig } from "@phreshos/core"

export default defineConfig({
    identity: "lemo",
    name: "Lemo",
    description: "The official PhreshOS agent.",
    version: "0.1.23",
    icon: "icon.png",
    categories: ["Productivity", "AI"],
    keywords: ["agent", "tasks", "memory", "tools"],
    website: "https://github.com/PhreshOS/lemo-program",
    buildCommand: "vite-node scripts/build.ts",
    server: {
        start: false,
        location: "dist/server",
        entryFile: "main.js",
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
            startCommand: "vite --config vite.client.ts"
        }
    }
})
