import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const webDir = dirname(fileURLToPath(import.meta.url));
const localVersion = readFileSync(resolve(webDir, "../VERSION"), "utf8").trim() || "dev";

export default defineConfig({
    base: process.env.VITE_BASE || "/",
    server: {
        fs: { allow: [resolve(webDir, "..")] },
        // Preserve the browser-facing Host so the backend can verify same-origin requests.
        proxy: {
            "/api": { target: "http://127.0.0.1:8080", changeOrigin: false },
            "/mcp": { target: "http://127.0.0.1:8080", changeOrigin: false },
        },
    },
    plugins: [react()],
    resolve: {
        dedupe: ["react", "react-dom", "react-i18next", "lucide-react", "three"],
        alias: {
            "@": resolve(webDir, "src"),
            "@dream-canvas/plugin-sdk": resolve(webDir, "../plugins/canvas/sdk/src"),
            "react": resolve(webDir, "node_modules/react"),
            "three": resolve(webDir, "node_modules/three"),
        },
    },
    define: {
        __APP_VERSION__: JSON.stringify(localVersion),
    },
});
