import i18n from "@/i18n";
import { assetBlob, assetId, assetUrl, getAsset, uploadAsset } from "@/services/api/assets";
import { captureSession } from "@/services/api/client";

export type UploadedImage = { url: string; storageKey?: string; width: number; height: number; bytes: number; mimeType: string };
type ImageReadOptions = { signal?: AbortSignal };

export async function uploadImage(input: string | Blob, options?: ImageReadOptions): Promise<UploadedImage> {
    const assertSession = captureSession();
    const id = typeof input === "string" ? assetId(input) : undefined;
    let asset = id ? await getAsset(id) : null;
    if (!asset) {
        const response = typeof input === "string" ? await fetch(input, { signal: options?.signal }) : null;
        if (response && !response.ok) throw new Error(i18n.t("errors.imageReadFailed"));
        const blob = typeof input === "string" ? await response!.blob() : input;
        assertSession();
        asset = await uploadAsset(blob, input instanceof File ? input.name : i18n.t("errors.imageAsset"), options?.signal);
    }
    if (asset.kind !== "image" || asset.deleteState) throw new Error(asset.deleteState ? i18n.t("errors.assetDeleted") : i18n.t("errors.chooseImage"));
    if (asset.saveState !== "saved") throw new Error(i18n.t("errors.imageNotSaved"));
    assertSession();
    let width = asset.width, height = asset.height;
    if (!width || !height) {
        const image = new Image();
        image.src = assetUrl(asset.id);
        await image.decode();
        assertSession();
        width = image.naturalWidth;
        height = image.naturalHeight;
        image.src = "";
    }
    window.dispatchEvent(new Event("assets-changed"));
    return { url: assetUrl(asset.id), storageKey: `asset:${asset.id}`, width, height, bytes: asset.bytes, mimeType: asset.mimeType };
}

export async function resolveImageUrl(storageKey?: string, fallback = "") {
    const id = assetId(storageKey);
    return id ? assetUrl(id) : fallback;
}
export async function getImageBlob(storageKey: string) {
    const id = assetId(storageKey);
    return id ? assetBlob(id) : null;
}
export function previewUrlFor(key?: string) { const id = assetId(key); return id ? `/api/assets/${encodeURIComponent(id)}/preview` : undefined; }
export function subscribeImagePreviews(_listener: () => void) { return () => {}; }
export const getImagePreviewRevision = () => 0;
export async function ensureImagePreview(key?: string) { return previewUrlFor(key); }

export async function imageToDataUrl(image: { url?: string; dataUrl?: string; storageKey?: string }, options?: ImageReadOptions) {
    const assertSession = captureSession();
    const url = await resolveImageUrl(image.storageKey, image.dataUrl || image.url || "");
    if (!url || url.startsWith("data:")) return url;
    const response = await fetch(url, { signal: options?.signal });
    if (!response.ok) throw new Error(response.status === 410 ? i18n.t("errors.assetDeleted") : i18n.t("errors.imageReadFailed"));
    const blob = await response.blob();
    assertSession();
    const result = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error(i18n.t("errors.imageReadFailed"))); reader.readAsDataURL(blob); });
    assertSession();
    return result;
}

// Removing a canvas reference never deletes an asset. Physical deletion goes through approvals.
export async function deleteStoredImages(_keys: Iterable<string>) { /* Physical deletion is owned by the server approval flow. */ }
export async function cleanupUnusedImages(_usedData: unknown) { /* Unreferenced media remains in the private asset library. */ }
export function collectImageStorageKeys(value: unknown, keys = new Set<string>()) {
    if (!value || typeof value !== "object") return keys;
    if ("storageKey" in value && typeof value.storageKey === "string" && assetId(value.storageKey)) keys.add(value.storageKey);
    Object.values(value).forEach((item) => { if (Array.isArray(item)) item.forEach((child) => collectImageStorageKeys(child, keys)); else collectImageStorageKeys(item, keys); });
    return keys;
}
