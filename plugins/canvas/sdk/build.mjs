// 共享构建助手:插件的 build.mjs 只需一行 `buildPlugin(import.meta.url)`。
// 统一 esbuild 配置：automatic JSX 指向本 SDK、react external、TS/TSX/CSS loader。
// 独立产物只用于源码开发参考；应用内置节点由 web 直接打包。

import { build, context } from "esbuild";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * @param {string} metaUrl 插件 build.mjs 的 import.meta.url
 * @param {{ name?: string, entry?: string, esbuild?: object, plugins?: import("esbuild").Plugin[] }} [overrides]
 */
export async function buildPlugin(metaUrl, overrides = {}) {
    const root = dirname(fileURLToPath(metaUrl));
    const name = overrides.name ?? basename(root);
    const distDir = join(root, "dist");
    const watch = process.argv.includes("--watch");
    const entry = overrides.entry ?? join(root, "src", "index.tsx");

    const options = {
        entryPoints: [entry],
        outfile: join(distDir, `${name}.js`),
        bundle: true,
        format: "esm",
        platform: "browser",
        target: "es2020",
        // automatic JSX → 转发到本 SDK 的 jsx-runtime(内部用宿主 React),插件无需自带 React
        jsx: "automatic",
        jsxImportSource: "@dream-canvas/plugin-sdk",
        loader: { ".js": "jsx", ".jsx": "jsx", ".ts": "ts", ".tsx": "tsx", ".css": "text" },
        // 宿主提供单例 React,插件不打包 react;https:// 依赖 esbuild 自动 external
        external: ["react", "react-dom"],
        minify: !watch,
        plugins: overrides.plugins ?? [],
        ...overrides.esbuild,
    };

    if (watch) {
        const ctx = await context(options);
        await ctx.watch();
        console.log(`[${name}] watching src/ ...`);
    } else {
        await build(options);
        console.log(`[${name}] built → dist/${name}.js`);
    }
}
