import { saveAs } from "file-saver";

import i18n from "@/i18n";
import { createZip } from "@/lib/zip";
import { collectPackageAssets } from "@/lib/canvas/asset-package";
import { captureSession } from "@/services/api/client";
import { getMediaBlob } from "@/services/file-storage";
import { assetId } from "@/services/api/assets";
import type { CanvasExportAsset, CanvasExportFile } from "@/types/canvas-export";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

export async function exportCanvasProjects(projects: CanvasProject[], fileName = i18n.t("canvas.export.defaultProjectName")) {
    const assertSession = captureSession();
    const zipFiles: { name: string; data: BlobPart }[] = [];
    const exportedProjects = await Promise.all(
        projects.map(async (project) => {
            const files: CanvasExportAsset[] = [];
            for (const storageKey of collectPackageAssets(project)) {
                    assertSession();
                    const blob = await getMediaBlob(storageKey);
                    if (!blob) throw new Error("引用的媒体无法读取，项目包未导出");
                    const path = `projects/${project.id}/files/${safeFileName(storageKey)}.${fileExtension(blob.type)}`;
                    files.push({ storageKey, path, mimeType: blob.type || "application/octet-stream", bytes: blob.size });
                    zipFiles.push({ name: path, data: blob });
            }
            return { project, files };
        }),
    );

    const data: CanvasExportFile = { app: "infinite-canvas", version: 3, exportedAt: new Date().toISOString(), projects: exportedProjects };
    const zip = await createZip([{ name: "projects.json", data: JSON.stringify(data, null, 2) }, ...zipFiles]);
    assertSession();
    saveAs(zip, `${safeFileName(fileName)}.zip`);
}

export async function exportCanvasNodes(nodes: CanvasNodeData[], fileName = i18n.t("canvas.export.defaultNodesName")) {
    const assertSession = captureSession();
    const zipFiles: { name: string; data: BlobPart }[] = [];
    const used = new Set<string>();
    const uniqueName = (base: string, ext: string) => {
        const safe = safeFileName(base) || i18n.t("canvas.export.item");
        let name = `${safe}.${ext}`;
        for (let i = 1; used.has(name); i += 1) name = `${safe}-${i}.${ext}`;
        used.add(name);
        return name;
    };

    await Promise.all(
        nodes.map(async (node) => {
            const title = node.title || node.type;
            assertSession();
            const content = node.metadata?.content;
            if (content?.startsWith("deleted-asset:") || node.metadata?.storageKey?.startsWith("deleted-asset:")) return void zipFiles.push({ name: uniqueName(title, "json"), data: JSON.stringify(node, null, 2) });
            const storageKey = node.metadata?.storageKey || (assetId(content) ? `asset:${assetId(content)}` : "");
            if (storageKey) {
                const blob = await getMediaBlob(storageKey);
                if (blob) return void zipFiles.push({ name: uniqueName(title, fileExtension(blob.type)), data: blob });
            }
            if (node.type === CanvasNodeType.Text) return void zipFiles.push({ name: uniqueName(title, "txt"), data: node.metadata?.content || node.metadata?.prompt || "" });
            if (content && content.startsWith("data:")) {
                const blob = await (await fetch(content)).blob();
                return void zipFiles.push({ name: uniqueName(title, fileExtension(blob.type)), data: blob });
            }
            zipFiles.push({ name: uniqueName(title, "json"), data: JSON.stringify(node, null, 2) });
        }),
    );

    const zip = await createZip(zipFiles);
    assertSession();
    saveAs(zip, `${safeFileName(fileName)}.zip`);
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
    if (mimeType.includes("mpeg") || mimeType.includes("mp3")) return "mp3";
    if (mimeType.includes("wav")) return "wav";
    if (mimeType.includes("ogg")) return "ogg";
    return "bin";
}
