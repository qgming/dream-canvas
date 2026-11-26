import { saveAs } from "file-saver";
import { z } from "zod";
import i18n from "@/i18n";

import { createZip, readZip, ZipLimitError } from "@/lib/zip";
import { getMediaBlob } from "@/services/file-storage";
import { DEFAULT_ASSET_PROJECT_ID, uploadAsset, type ServerAsset } from "@/services/api/assets";
import { captureSession } from "@/services/api/client";
import { collectPackageAssets, replacePackageAssets } from "@/lib/canvas/asset-package";
import { useAssetStore, type Asset } from "@/stores/use-asset-store";

const assetFields = z.object({ title: z.string(), coverUrl: z.string(), source: z.string().optional(), note: z.string().optional(), metadata: z.record(z.unknown()).optional() });
const mediaData = z.object({ storageKey: z.string(), width: z.number(), height: z.number(), bytes: z.number(), mimeType: z.string(), durationMs: z.number().optional() });
const fileEntry = z.object({ storageKey: z.string(), path: z.string(), mimeType: z.string(), bytes: z.number().int().nonnegative() });
const assetPackage = z.object({
    app: z.literal("infinite-canvas"), version: z.literal(1), projectTitle: z.string().optional(),
    assets: z.array(z.discriminatedUnion("kind", [
        assetFields.extend({ kind: z.literal("text"), data: z.object({ content: z.string() }) }),
        assetFields.extend({ kind: z.literal("image"), data: mediaData.extend({ dataUrl: z.string() }) }),
        assetFields.extend({ kind: z.literal("video"), data: mediaData.extend({ url: z.string() }) }),
        assetFields.extend({ kind: z.literal("audio"), data: mediaData.extend({ url: z.string() }) }),
    ])),
    files: z.array(fileEntry),
});

export async function exportAssets(assets: Asset[], filename: string, projectTitle?: string) {
    const assertSession = captureSession();
    const files: z.infer<typeof fileEntry>[] = [];
    const zipFiles: { name: string; data: BlobPart }[] = [];

    for (const storageKey of collectPackageAssets(assets)) {
        assertSession();
        const blob = await getMediaBlob(storageKey);
        if (!blob) throw new Error(i18n.t("backup.mediaReadFailed"));
        const path = `files/${safeFileName(storageKey)}.${fileExtension(blob.type)}`;
        files.push({ storageKey, path, mimeType: blob.type, bytes: blob.size });
        zipFiles.push({ name: path, data: blob });
    }

    const data = { app: "infinite-canvas", version: 1, exportedAt: new Date().toISOString(), projectTitle, assets, files };
    const zip = await createZip([{ name: "assets.json", data: JSON.stringify(data, null, 2) }, ...zipFiles]);
    assertSession();
    saveAs(zip, filename);
}

export async function importAssetPackage(file: File, createTarget?: (projectTitle?: string) => Promise<string>): Promise<number> {
    const assertSession = captureSession();
    const invalidPackage = () => new Error(i18n.t("backup.invalidPackage"));
    const missingOriginal = () => new Error(i18n.t("backup.missingOriginal"));
    const zip = await readZip(file).catch((error) => {
        if (error instanceof ZipLimitError) throw error;
        throw invalidPackage();
    });
    const assetFile = zip.get("assets.json");
    if (!assetFile) throw invalidPackage();
    const parsed = assetPackage.safeParse(await assetFile.text().then(JSON.parse).catch(() => null));
    if (!parsed.success) throw invalidPackage();
    const { assets, files: entries, projectTitle } = parsed.data;

    const originals = new Map<string, Blob>();
    for (const entry of entries) {
        if (!entry.storageKey.startsWith("asset:") || entry.storageKey.length === 6) throw new Error(i18n.t("backup.unsupportedPackage"));
        if (originals.has(entry.storageKey) || !/^files\/[^/\\]+$/.test(entry.path)) throw invalidPackage();
        const blob = zip.get(entry.path);
        if (!blob?.size || blob.size !== entry.bytes) throw missingOriginal();
        originals.set(entry.storageKey, blob.type ? blob : blob.slice(0, blob.size, entry.mimeType));
    }
    const primaryTitles = new Map<string, string>();
    for (const asset of assets) {
        if (asset.kind === "text") continue;
        if (!originals.has(asset.data.storageKey)) throw missingOriginal();
        if (primaryTitles.has(asset.data.storageKey)) throw invalidPackage();
        primaryTitles.set(asset.data.storageKey, asset.title);
    }
    const required = collectPackageAssets(assets);
    for (const key of required) if (!originals.has(key)) throw missingOriginal();

    assertSession();
    const assetProjectId = createTarget ? await createTarget(projectTitle) : DEFAULT_ASSET_PROJECT_ID;
    const files = new Map<string, ServerAsset>();
    for (const key of required) {
        assertSession();
        files.set(key, await uploadAsset(originals.get(key)!, primaryTitles.get(key), { assetProjectId }));
    }
    const imported = replacePackageAssets(assets, files);
    for (const asset of imported) {
        assertSession();
        await useAssetStore.getState().addAsset(asset, assetProjectId);
    }
    assertSession();
    return imported.length;
}

function safeFileName(value: string) {
    return value.replace(/[\\/:*?"<>|]/g, "_");
}

function fileExtension(mimeType: string) {
    if (mimeType.includes("png")) return "png";
    if (mimeType.includes("jpeg")) return "jpg";
    if (mimeType.includes("webp")) return "webp";
    if (mimeType.includes("gif")) return "gif";
    if (mimeType.includes("mp4")) return "mp4";
    if (mimeType.includes("webm")) return "webm";
    return "bin";
}
