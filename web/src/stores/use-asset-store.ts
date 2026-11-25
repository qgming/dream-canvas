import i18n from "@/i18n";
import { create } from "zustand";

import * as api from "@/services/api/assets";
import { useAuthStore } from "@/stores/use-auth-store";
import { previewUrlFor } from "@/services/image-storage";
import { captureSession } from "@/services/api/client";

export type AssetKind = "text" | "image" | "video" | "audio";
type AssetBase<T extends AssetKind> = { id: string; assetProjectId: string; kind: T; title: string; coverUrl: string; source?: string; note?: string; createdAt: string; updatedAt: string; metadata?: Record<string, unknown>; syncState?: string; saveState?: string; storageId?: string; storageName?: string; migration?: api.AssetMigration; error?: string };
export type TextAsset = AssetBase<"text"> & { data: { content: string } };
export type ImageAsset = AssetBase<"image"> & { data: { dataUrl: string; storageKey?: string; width: number; height: number; bytes: number; mimeType: string } };
export type VideoAsset = AssetBase<"video"> & { data: { url: string; storageKey?: string; width: number; height: number; bytes: number; mimeType: string; durationMs?: number } };
export type AudioAsset = AssetBase<"audio"> & { data: { url: string; storageKey?: string; width: number; height: number; bytes: number; mimeType: string; durationMs?: number } };
export type Asset = TextAsset | ImageAsset | VideoAsset | AudioAsset;
type AssetInput = Asset extends infer T ? T extends Asset ? Omit<T, "id" | "assetProjectId" | "createdAt" | "updatedAt"> : never : never;
type AssetStore = {
    hydrated: boolean; assets: Asset[]; error: string; deleting: api.ServerAsset[];
    loadAssets: () => Promise<void>;
    reset: () => void;
    addAsset: (asset: AssetInput, assetProjectId?: string) => Promise<string>;
    updateAsset: (id: string, patch: Partial<Omit<Asset, "id" | "assetProjectId" | "createdAt">>) => Promise<void>;
    removeAsset: (id: string) => Promise<string>;
    cleanupImages: (extra?: unknown) => void;
};

function fromServer(record: api.ServerAsset): Asset {
    const meta = { ...record.metadata };
    delete meta.tags;
    const base = { id: record.id, assetProjectId: record.assetProjectId, kind: record.kind, title: record.title, coverUrl: typeof meta.coverUrl === "string" ? meta.coverUrl : "", source: typeof meta.source === "string" ? meta.source : undefined, note: typeof meta.note === "string" ? meta.note : undefined, metadata: meta, createdAt: record.createdAt, updatedAt: record.updatedAt, syncState: record.syncState, saveState: record.saveState, storageId: record.storageId, storageName: record.storageName, migration: record.migration, error: [record.error, record.probeError, record.previewError].filter(Boolean).join(" · ") };
    if (record.kind === "text") return { ...base, kind: "text", data: { content: typeof meta.content === "string" ? meta.content : "" } };
    const data = { storageKey: `asset:${record.id}`, width: record.width, height: record.height, bytes: record.bytes, mimeType: record.mimeType, durationMs: record.durationMs };
    if (record.kind === "image") return { ...base, kind: "image", data: { ...data, dataUrl: api.assetUrl(record.id) } };
    if (record.kind === "video") return { ...base, kind: "video", data: { ...data, url: api.assetUrl(record.id) } };
    return { ...base, kind: "audio", data: { ...data, url: api.assetUrl(record.id) } };
}

export function assetCoverUrl(asset: Asset) {
    if (asset.kind === "video" && !asset.coverUrl && asset.saveState === "saved") return `/api/assets/${encodeURIComponent(asset.id)}/preview`;
    if (asset.kind === "image" && (!asset.coverUrl || asset.coverUrl === asset.data.dataUrl)) {
        return asset.data.mimeType === "image/svg+xml" ? asset.data.dataUrl : previewUrlFor(asset.data.storageKey) || asset.data.dataUrl;
    }
    return asset.coverUrl;
}

let loadSequence = 0;
export const useAssetStore = create<AssetStore>((set, get) => ({
    hydrated: false, assets: [], error: "", deleting: [],
    reset: () => { loadSequence++; set({ hydrated: false, assets: [], error: "", deleting: [] }); },
    loadAssets: async () => {
        const owner = useAuthStore.getState().user?.id;
        if (!owner) return;
        const sequence = ++loadSequence;
        try {
            const [records, deleting] = await Promise.all([api.listAssets(), api.listDeletingAssets()]);
            if (sequence === loadSequence && useAuthStore.getState().user?.id === owner) {
                for (const previous of get().assets) if (!records.some((record) => record.id === previous.id)) window.dispatchEvent(new CustomEvent("asset-deleted", { detail: previous.id }));
                set({ assets: records.map(fromServer), deleting, hydrated: true, error: "" });
            }
        } catch (error) { if (sequence === loadSequence && useAuthStore.getState().user?.id === owner) set({ hydrated: true, error: error instanceof Error ? error.message : i18n.t("errors.assetReadFailed") }); }
    },
    addAsset: async (input, assetProjectId) => {
        const assertSession = captureSession();
        const metadata: Record<string, unknown> = { ...input.metadata, coverUrl: input.coverUrl, source: input.source, note: input.note, ...(input.kind === "text" ? input.data : {}) };
        delete metadata.tags;
        let id: string;
        if (input.kind === "text") id = (await api.createTextAsset(input.title, metadata, assetProjectId)).id;
        else {
            id = api.assetId((input.data as ImageAsset["data"]).storageKey) || "";
            if (!id) throw new Error(i18n.t("errors.mediaNotUploaded"));
            await api.updateAsset(id, input.title, metadata, assetProjectId);
        }
        assertSession();
        await get().loadAssets();
        assertSession();
        return id;
    },
    updateAsset: async (id, patch) => {
        const assertSession = captureSession();
        const current = get().assets.find((asset) => asset.id === id);
        if (!current) throw new Error(i18n.t("errors.assetMissing"));
        const next = { ...current, ...patch } as Asset;
        const metadata: Record<string, unknown> = { ...next.metadata, coverUrl: next.coverUrl, source: next.source, note: next.note, ...(next.kind === "text" ? next.data : {}) };
        delete metadata.tags;
        await api.updateAsset(id, next.title, metadata);
        assertSession();
        await get().loadAssets();
    },
    removeAsset: async (id) => {
        const assertSession = captureSession();
        const result = await api.deleteAsset(id);
        assertSession();
        await get().loadAssets();
        assertSession();
        window.dispatchEvent(new CustomEvent("asset-deleted", { detail: id }));
        return result.deleteState;
    },
    cleanupImages: () => {},
}));
