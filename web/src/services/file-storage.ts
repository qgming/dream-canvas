import { assetBlob, assetId, assetUrl, getAsset, uploadAsset } from "@/services/api/assets";
import { captureSession } from "@/services/api/client";

export type UploadedFile = { url: string; storageKey: string; bytes: number; mimeType: string; width?: number; height?: number; durationMs?: number };

export async function uploadMediaFile(input: string | Blob, prefix = "file"): Promise<UploadedFile> {
    const assertSession = captureSession();
    const id = typeof input === "string" ? assetId(input) : undefined;
    let asset = id ? await getAsset(id) : null;
    if (!asset) {
        const response = typeof input === "string" ? await fetch(input) : null;
        if (response && !response.ok) throw new Error("媒体读取失败");
        const blob = typeof input === "string" ? await response!.blob() : input;
        assertSession();
        asset = await uploadAsset(blob, input instanceof File ? input.name : "媒体素材");
    }
    if (asset.deleteState) throw new Error("资产已删除");
    if (asset.saveState !== "saved") throw new Error("媒体尚未可靠保存");
    if (asset.kind !== "video" && asset.kind !== "audio") throw new Error("请选择视频或音频素材");
    if ((prefix === "video" || prefix === "audio") && asset.kind !== prefix) throw new Error("媒体类型不匹配");
    assertSession();
    const url = assetUrl(asset.id);
    const element = document.createElement(asset.kind === "audio" ? "audio" : "video");
    element.preload = "metadata";
    const meta = await new Promise<{ width?: number; height?: number; durationMs?: number }>((resolve) => {
        const finish = () => {
            resolve({ ...(element instanceof HTMLVideoElement ? { width: element.videoWidth, height: element.videoHeight } : {}), durationMs: Number.isFinite(element.duration) ? Math.round(element.duration * 1000) : undefined });
            element.onloadedmetadata = null;
            element.onerror = null;
            element.removeAttribute("src");
            element.load();
        };
        element.onloadedmetadata = finish;
        element.onerror = finish;
        element.src = url;
    });
    assertSession();
    window.dispatchEvent(new Event("assets-changed"));
    return { url, storageKey: `asset:${asset.id}`, bytes: asset.bytes, mimeType: asset.mimeType, ...meta };
}
export async function resolveMediaUrl(key?: string, fallback = "") { const id = assetId(key); return id ? assetUrl(id) : fallback; }
export async function getMediaBlob(key: string) { const id = assetId(key); return id ? assetBlob(id) : null; }
export async function deleteStoredMedia(_keys: Iterable<string>) { /* References do not own the server asset. */ }
export async function cleanupUnusedMedia(_usedData: unknown) { /* Global deletion requires an explicit approval. */ }
export function collectMediaStorageKeys(value: unknown, keys = new Set<string>()) {
    if (!value || typeof value !== "object") return keys;
    if ("storageKey" in value && typeof value.storageKey === "string" && assetId(value.storageKey)) keys.add(value.storageKey);
    Object.values(value).forEach((item) => { if (Array.isArray(item)) item.forEach((child) => collectMediaStorageKeys(child, keys)); else collectMediaStorageKeys(item, keys); });
    return keys;
}
