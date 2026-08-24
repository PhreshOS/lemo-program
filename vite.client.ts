import react, { reactCompilerPreset } from "@vitejs/plugin-react"
import babel from "@rolldown/plugin-babel"
import { defineConfig } from "vite"
import { resolve } from "node:path"

export default defineConfig({
    root: "source/client",
    plugins: [react(), babel({ presets: [reactCompilerPreset()] })],
    base: "./",
    resolve: {
        tsconfigPaths: true,
        dedupe: ["react"]
    },
    server: {
        cors: true,
        port: 5250,
        strictPort: true
    },
    build: {
        emptyOutDir: true,
        outDir: resolve(import.meta.dirname, "dist/client")
    }
})
