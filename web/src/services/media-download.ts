import { saveAs } from "file-saver";
import mime from "mime";

import i18n from "@/i18n";
import { assetBlob, assetId } from "@/services/api/assets";
import { captureSession } from "@/services/api/client";

export type MediaDownloadSource = { url: string; storageKey?: string; mimeType?: string };
const mediaExtensions: Record<string, string> = { "audio/mpeg": "mp3", "audio/flac": "flac", "audio/pcm": "pcm", "audio/opus": "opus", "video/quicktime": "mov" };

export async function downloadMediaFile(source: MediaDownloadSource, name: string) {
    const assertSession = captureSession();
    const id = assetId(source.storageKey) || assetId(source.url);
    let blob: Blob;
    if (id) blob = await assetBlob(id);
    else {
        const response = await fetch(source.url);
        assertSession();
        if (!response.ok) throw new Error(i18n.t("assets.downloadFailed"));
        blob = await response.blob();
    }
    assertSession();
    const responseType = blob.type.split(";")[0].trim().toLowerCase();
    const type = responseType && responseType !== "application/octet-stream" ? responseType : (source.mimeType || responseType).split(";")[0].trim().toLowerCase();
    const extension = mediaExtensions[type] || mime.getExtension(type) || "bin";
    const safeName = name.replace(/[\\/:*?"<>|]/g, "_") || "asset";
    const existingExtension = /\.([^.]+)$/.exec(safeName)?.[1].toLowerCase();
    const baseName = existingExtension && (mime.getType(existingExtension) || existingExtension === "pcm") ? safeName.slice(0, -existingExtension.length - 1) : safeName;
    saveAs(blob, existingExtension === extension || mime.getAllExtensions(type)?.has(existingExtension || "") ? safeName : `${baseName}.${extension}`);
}
