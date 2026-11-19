import i18n from "@/i18n";
import { registerNodeDefinitions, unregisterPluginNodes, setAvailableNodeTypes } from "./node-registry";
import { getPluginRuntime } from "./plugin-runtime";
import type { CanvasPlugin } from "@/types/canvas-plugin";
import type { CanvasPluginCatalogEntry } from "@/services/api/canvas-plugins";

const builtinModules: Record<string, () => Promise<{ default: unknown }>> = {
    markdown: () => import("../../../../plugins/canvas/markdown/src/index"),
    svg: () => import("../../../../plugins/canvas/svg/src/index"),
    html: () => import("../../../../plugins/canvas/html/src/index"),
    panorama: () => import("../../../../plugins/canvas/panorama/src/index"),
    "sticky-note": () => import("../../../../plugins/canvas/sticky-note/src/index"),
    upscale: () => import("../../../../plugins/canvas/upscale/src/index"),
};
const active = new Map<string, { version: string; dispose: () => void }>();
let generation = 0;

function resolvePlugin(exported: unknown, record: CanvasPluginCatalogEntry): CanvasPlugin {
    const value = typeof exported === "function" ? exported(getPluginRuntime()) : exported;
    const plugin = value as CanvasPlugin;
    if (!plugin || plugin.id !== record.id || !Array.isArray(plugin.nodes) || !plugin.nodes.length) throw new Error(i18n.t("canvas.pluginErrors.invalidExport"));
    const types = new Set(record.nodes.map((node) => node.type));
    if (plugin.nodes.length !== types.size || plugin.nodes.some((node) => !types.delete(node.type) || !node.defaultSize || node.defaultSize.width <= 0 || node.defaultSize.height <= 0 || !node.Content)) throw new Error(i18n.t("nodePlugins.manifestMismatch"));
    return plugin;
}

async function loadPlugin(record: CanvasPluginCatalogEntry): Promise<CanvasPlugin> {
    getPluginRuntime();
    if (record.builtin && builtinModules[record.id]) return resolvePlugin((await builtinModules[record.id]()).default, record);
    const url = URL.createObjectURL(new Blob([record.source || ""], { type: "text/javascript" }));
    try { return resolvePlugin((await import(/* @vite-ignore */ url)).default, record); }
    finally { URL.revokeObjectURL(url); }
}

export function resetCanvasPlugins() {
    generation++;
    for (const [id, state] of active) { state.dispose(); unregisterPluginNodes(id); }
    active.clear();
    setAvailableNodeTypes([]);
}

export async function syncCanvasPlugins(records: CanvasPluginCatalogEntry[]) {
    const request = ++generation;
    const enabled = records.filter((row) => row.enabled && row.publishedVersionId);
    const available = () => enabled.filter((row) => row.id.startsWith("builtin-") || active.get(row.id)?.version === row.publishedVersionId).flatMap((row) => row.nodes.map((node) => node.type));
    setAvailableNodeTypes(available());
    const byId = new Map(enabled.map((row) => [row.id, row]));
    for (const [id, state] of active) {
        if (byId.get(id)?.publishedVersionId === state.version) continue;
        state.dispose(); unregisterPluginNodes(id); active.delete(id);
    }
    const errors: string[] = [];
    await Promise.all(enabled.filter((row) => !row.id.startsWith("builtin-") && !active.has(row.id)).map(async (record) => {
        try {
            const plugin = await loadPlugin(record);
            if (request !== generation) return;
            const runtime = getPluginRuntime();
            const disposers: Array<() => void> = [];
            try {
                if (plugin.css) disposers.push(runtime.injectCSS(plugin.css, record.id));
                const dispose = plugin.setup?.(runtime);
                if (typeof dispose === "function") disposers.push(dispose);
                const nodes = plugin.nodes.map((node) => {
                    const spec = record.nodes.find((item) => item.type === node.type)!;
                    return record.builtin ? { ...node, get title() { return i18n.t(`nodePlugins.builtins.${record.id}`); } } : { ...node, ...spec, builtinRenderer: false };
                });
                registerNodeDefinitions(nodes, record.id);
            } catch (error) { disposers.forEach((dispose) => dispose()); throw error; }
            active.set(record.id, { version: record.publishedVersionId, dispose: () => disposers.forEach((dispose) => dispose()) });
        } catch (error) { if (request === generation) errors.push(`${record.name}: ${error instanceof Error ? error.message : String(error)}`); }
    }));
    if (request !== generation) return;
    setAvailableNodeTypes(available());
    if (errors.length) throw new Error(errors.join("\n"));
}
