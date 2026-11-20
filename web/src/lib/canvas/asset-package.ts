import type { ServerAsset } from "@/services/api/assets";
import { assetId, assetUrl } from "@/services/api/assets";

export function collectPackageAssets(value: unknown, keys = new Set<string>()) {
    const walk = (item: unknown, key = "") => {
        if (typeof item === "string") {
            if (item.startsWith("deleted-asset:")) return;
            const id = assetId(item) || (key === "assetId" ? item : "");
            if (id) keys.add(`asset:${id}`);
        } else if (Array.isArray(item)) item.forEach((child) => walk(child, key));
        else if (item && typeof item === "object") Object.entries(item).forEach(([name, child]) => { if (!["title", "name", "prompt", "composerContent", "text", "instructions", "systemPrompt", "errorDetails"].includes(name)) walk(child, name); });
    };
    walk(value);
    return keys;
}

export function replacePackageAssets<T>(value: T, files: Map<string, ServerAsset>): T {
    const urls = new Map<string, string>([...files].flatMap(([key, asset]): [string, string][] => {
        const id = key.startsWith("asset:") ? key.slice(6) : "";
        return id ? [[`/api/assets/${id}/file`, assetUrl(asset.id)], [`/api/assets/${id}/preview`, `/api/assets/${asset.id}/preview`]] : [];
    }));
    const walk = (item: unknown): unknown => {
        if (typeof item === "string") {
            const asset = files.get(item);
            return asset ? `asset:${asset.id}` : urls.get(item) || item;
        }
        if (Array.isArray(item)) return item.map(walk);
        if (!item || typeof item !== "object") return item;
        const result = Object.fromEntries(Object.entries(item).map(([key, child]) => [key, key === "name" ? child : key === "assetId" && typeof child === "string" ? files.get(`asset:${child}`)?.id || child : walk(child)]));
        if (typeof result.storageKey === "string" && result.storageKey.startsWith("asset:")) {
            const url = assetUrl(result.storageKey.slice(6));
            for (const key of ["url", "content", "dataUrl"]) if (typeof result[key] === "string") result[key] = url;
        }
        return result;
    };
    return walk(value) as T;
}
