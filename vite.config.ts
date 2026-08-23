import { defineConfig } from "vite"
import { resolve } from "node:path"

export default defineConfig({
    root: "source/server",
    resolve: {
        tsconfigPaths: true
    },
    build: {
        ssr: true,
        emptyOutDir: true,
        outDir: resolve(import.meta.dirname, "dist/server"),
        rolldownOptions: {
            input: "main.ts"
        }
    }
})
