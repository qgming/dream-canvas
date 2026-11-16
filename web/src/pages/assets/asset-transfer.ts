import { saveAs } from "file-saver";

import { createZip, readZip } from "@/lib/zip";
import { getMediaBlob } from "@/services/file-storage";
import { uploadAsset, type ServerAsset } from "@/services/api/assets";
import { captureSession } from "@/services/api/client";
import { collectPackageAssets, replacePackageAssets } from "@/lib/canvas/asset-package";
import type { Asset } from "@/stores/use-asset-store";

type AssetExportFile = {
    app: "infinite-canvas";
    version: 1;
    exportedAt: string;
    assets: Asset[];
    files: AssetExportItem[];
};

type AssetExportItem = {
    storageKey: string;
    path: string;
    mimeType: string;
    bytes: number;
};

export async function exportAssets(assets: Asset[], filename: string) {
    const assertSession = captureSession();
    const files: AssetExportItem[] = [];
    const zipFiles: { name: string; data: BlobPart }[] = [];

    for (const storageKey of collectPackageAssets(assets)) {
            assertSession();
            const blob = await getMediaBlob(storageKey);
            if (!blob) throw new Error("引用的媒体无法读取，资产包未导出");
            const path = `files/${safeFileName(storageKey)}.${fileExtension(blob.type)}`;
            files.push({ storageKey, path, mimeType: blob.type, bytes: blob.size });
            zipFiles.push({ name: path, data: blob });
    }

    const data: AssetExportFile = { app: "infinite-canvas", version: 1, exportedAt: new Date().toISOString(), assets, files };
    const zip = await createZip([{ name: "assets.json", data: JSON.stringify(data, null, 2) }, ...zipFiles]);
    assertSession();
    saveAs(zip, filename);
}

export async function readAssetPackage(file: File) {
    const assertSession = captureSession();
    const zip = await readZip(file);
    const assetFile = zip.get("assets.json");
    if (!assetFile) throw new Error("missing assets.json");
    const data = JSON.parse(await assetFile.text()) as AssetExportFile;
    if (data.app !== "infinite-canvas" || data.version !== 1 || !Array.isArray(data.assets)) throw new Error("资产包格式不正确");
    const files = new Map<string, ServerAsset>();
    for (const item of data.files) {
        assertSession();
        if (!item.storageKey.startsWith("asset:")) throw new Error("仅支持当前服务端格式的资产包，不迁移旧本地数据");
        const blob = zip.get(item.path);
        if (!blob) throw new Error("资产包缺少媒体原件");
        files.set(item.storageKey, await uploadAsset(blob.type ? blob : blob.slice(0, blob.size, item.mimeType)));
    }
    assertSession();
    return replacePackageAssets(data.assets, files);
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
