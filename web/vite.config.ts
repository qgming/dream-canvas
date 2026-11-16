import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const webDir = dirname(fileURLToPath(import.meta.url));
const localVersion = readFileSync(resolve(webDir, "../VERSION"), "utf8").trim() || "dev";

// Expose /plugins/index.json with local plugin files from public/plugins.
// The frontend can discover and list them when enabled; development reads the directory live, while builds emit a static registry.
function localPluginsManifest(): Plugin {
    const pluginsDir = resolve(webDir, "public/plugins");
    const registryPath = resolve(pluginsDir, "official/official-plugins.json");
    const emptyRegistry = JSON.stringify({ version: 1, plugins: [] });
    const listLocalPlugins = () => {
        try {
            return readdirSync(pluginsDir)
                .filter((file) => file.endsWith(".js"))
                .sort()
                .map((file) => `/plugins/${file}`);
        } catch {
            return [];
        }
    };
    return {
        name: "local-plugins-manifest",
        configureServer(server) {
            server.middlewares.use("/plugins/official/official-plugins.json", (_req, res) => {
                res.setHeader("Content-Type", "application/json");
                res.end(existsSync(registryPath) ? readFileSync(registryPath, "utf8") : emptyRegistry);
            });
            server.middlewares.use("/plugins/index.json", (_req, res) => {
                res.setHeader("Content-Type", "application/json");
                res.end(JSON.stringify(listLocalPlugins()));
            });
        },
        generateBundle() {
            this.emitFile({ type: "asset", fileName: "plugins/index.json", source: JSON.stringify(listLocalPlugins()) });
            if (!existsSync(registryPath)) this.emitFile({ type: "asset", fileName: "plugins/official/official-plugins.json", source: emptyRegistry });
        },
    };
}

export default defineConfig({
    base: process.env.VITE_BASE || "/",
    server: {
        // Preserve the browser-facing Host so the backend can verify same-origin requests.
        proxy: {
            "/api": { target: "http://127.0.0.1:8080", changeOrigin: false },
            "/mcp": { target: "http://127.0.0.1:8080", changeOrigin: false },
        },
    },
    plugins: [react(), localPluginsManifest()],
    resolve: {
        alias: {
            "@": resolve(webDir, "src"),
        },
    },
    define: {
        __APP_VERSION__: JSON.stringify(localVersion),
    },
});
