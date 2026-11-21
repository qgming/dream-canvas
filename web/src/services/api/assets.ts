import i18n from "@/i18n";
import { apiRequest, captureSession, jsonRequest } from "./client";

export type ServerAsset = {
    id: string; kind: "text" | "image" | "video" | "audio"; title: string; mimeType: string; bytes: number; width: number; height: number;
    saveState: string; syncState: string; deleteState: string; retainCloud?: boolean; cleanupTaskId?: string; error?: string; storageId?: string; metadata: Record<string, unknown>; durationMs: number; probeError?: string; previewError?: string;
    storageName?: string; migration?: AssetMigration;
    workbenchRecordId?: string; createdAt: string; updatedAt: string;
};
export type AssetMigration = { storageId: string; storageName: string; state: string; error?: string };
export type AssetStorageOption = { id: string; name: string; default: boolean };
export const listAssetStorages = () => apiRequest<AssetStorageOption[]>("/asset-storages");
export const migrateAsset = (id: string, storageId: string, expectedUpdatedAt: string) => apiRequest<{ queued: boolean }>(`/assets/${encodeURIComponent(id)}/migrate`, jsonRequest("POST", { storageId, expectedUpdatedAt }));
export const assetUrl = (id: string) => `/api/assets/${encodeURIComponent(id)}/file`;
export const assetId = (key = "") => key.startsWith("asset:") ? key.slice(6) : /^\/api\/assets\/([^/]+)\/(?:file|preview)$/.exec(key)?.[1];
export const listAssets = () => apiRequest<ServerAsset[]>("/assets");
export const listDeletingAssets = () => apiRequest<ServerAsset[]>("/assets?deleting=true");
export const retryAssetCleanup = (id: string, options: { retainCloud?: boolean; confirmed?: boolean } = {}) => apiRequest<{ deleteState: string }>(`/assets/${encodeURIComponent(id)}/cleanup`, jsonRequest("POST", options));
export const retryAssetSync = (id: string) => apiRequest<void>(`/assets/${encodeURIComponent(id)}/sync`, { method: "POST" });
export const getAsset = (id: string) => apiRequest<ServerAsset>(`/assets/${encodeURIComponent(id)}`);
export const deleteAsset = (id: string) => apiRequest<{ assetId: string; deleteState: string }>(`/assets/${encodeURIComponent(id)}`, { method: "DELETE" });
export const uploadAsset = (blob: Blob, title = i18n.t("errors.untitledAsset"), signal?: AbortSignal, workbenchRecordId?: string) => apiRequest<ServerAsset>("/assets", { method: "POST", body: blob, signal, headers: { "Content-Type": blob.type || "application/octet-stream", "X-File-Name": encodeURIComponent(title), ...(workbenchRecordId ? { "X-Workbench-Record": workbenchRecordId } : {}) } });
export const updateAsset = (id: string, title: string, metadata: Record<string, unknown>) => apiRequest<void>(`/assets/${encodeURIComponent(id)}`, jsonRequest("PATCH", { title, metadata }));
export const createTextAsset = (title: string, metadata: Record<string, unknown>) => apiRequest<ServerAsset>("/assets/text", jsonRequest("POST", { title, metadata }));
export type AssetVoice = { assetId: string; channelId: string; voiceId: string; version: number };
export const listAssetVoices = (id: string) => apiRequest<AssetVoice[]>(`/assets/${encodeURIComponent(id)}/voices`);
export const saveAssetVoice = (id: string, channelId: string, voiceId: string, version: number) => apiRequest<AssetVoice>(`/assets/${encodeURIComponent(id)}/voices/${encodeURIComponent(channelId)}`, jsonRequest("PUT", { voiceId, version }));
export async function assetBlob(id: string, signal?: AbortSignal) {
    const assertSession = captureSession();
    const response = await fetch(assetUrl(id), { signal, credentials: "same-origin" });
    assertSession();
    if (!response.ok) throw new Error(response.status === 410 ? i18n.t("errors.assetDeleted") : i18n.t("errors.assetFileReadFailed"));
    const blob = await response.blob();
    assertSession();
    return blob;
}
