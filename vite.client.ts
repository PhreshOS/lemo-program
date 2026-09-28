import react, { reactCompilerPreset } from "@vitejs/plugin-react"
import babel from "@rolldown/plugin-babel"
import { defineConfig } from "vite"
import { resolve } from "node:path"

export default defineConfig({
    root: "source/client",
    plugins: [react(), babel({ presets: [reactCompilerPreset()] })],
    base: process.env.PHRESHOS_CLIENT_BASE ?? "./",
    resolve: {
        tsconfigPaths: true,
        // Linked SDKs must consume the Program's renderer instance.
        dedupe: ["react", "react-dom"]
    },
    server: {
        // The address `phresh dev` chose, so it and the System reach this server.
        host: process.env.PHRESHOS_CLIENT_HOST,
        port: Number(process.env.PHRESHOS_CLIENT_PORT ?? "5200"),
        strictPort: true
    },
    build: {
        chunkSizeWarningLimit: 600,
        emptyOutDir: true,
        outDir: resolve(import.meta.dirname, "dist/client")
    }
})
