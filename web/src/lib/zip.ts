import { unzipSync, zipSync } from "fflate";
import i18n from "@/i18n";

type ZipFile = {
    name: string;
    data: BlobPart;
};

export type ReadZipLimits = {
    maxFiles: number;
    maxEntryBytes: number;
    maxTotalBytes: number;
};

export const MEDIA_ZIP_LIMITS: ReadZipLimits = {
    maxFiles: 5000,
    maxEntryBytes: 2 * 1024 * 1024 * 1024,
    maxTotalBytes: 2 * 1024 * 1024 * 1024,
};

export const SCRIPT_ZIP_LIMITS: ReadZipLimits = {
    maxFiles: 200,
    maxEntryBytes: 2 * 1024 * 1024,
    maxTotalBytes: 8 * 1024 * 1024,
};

export class ZipLimitError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ZipLimitError";
    }
}

export function isSafeZipEntryPath(name: string) {
    if (!name || name.startsWith("/") || name.startsWith("\\") || /[\\:\u0000\r\n]/.test(name)) return false;
    const trimmed = name.endsWith("/") ? name.slice(0, -1) : name;
    if (!trimmed) return false;
    return trimmed.split("/").every((part) => Boolean(part) && part !== "." && part !== "..");
}

function formatLimitBytes(bytes: number) {
    const gib = 1024 * 1024 * 1024;
    const mib = 1024 * 1024;
    if (bytes >= gib && bytes % gib === 0) return `${bytes / gib} GiB`;
    if (bytes >= mib && bytes % mib === 0) return `${bytes / mib} MiB`;
    return `${Math.round(bytes / mib)} MiB`;
}

export async function createZip(files: ZipFile[]) {
    const entries = await Promise.all(
        files.map(async (file) => {
            const data = new Uint8Array(await new Blob([file.data]).arrayBuffer());
            return [file.name, data] as const;
        }),
    );
    return new Blob([zipSync(Object.fromEntries(entries), { level: 0 })], { type: "application/zip" });
}

export async function readZipEntries(file: Blob, limits: ReadZipLimits = MEDIA_ZIP_LIMITS): Promise<Record<string, Uint8Array>> {
    if (file.size > limits.maxTotalBytes) {
        throw new ZipLimitError(i18n.t("ui.zipTooLarge", { limit: formatLimitBytes(limits.maxTotalBytes) }));
    }
    const raw = new Uint8Array(await file.arrayBuffer());
    let fileCount = 0;
    let totalDeclared = 0;
    const entries = unzipSync(raw, {
        filter(info) {
            if (!isSafeZipEntryPath(info.name)) {
                throw new ZipLimitError(i18n.t("ui.zipInvalidPath"));
            }
            if (info.name.endsWith("/")) return false;
            fileCount += 1;
            if (fileCount > limits.maxFiles) {
                throw new ZipLimitError(i18n.t("ui.zipTooManyFiles", { count: limits.maxFiles }));
            }
            if (info.originalSize > limits.maxEntryBytes) {
                throw new ZipLimitError(i18n.t("ui.zipEntryTooLarge", { limit: formatLimitBytes(limits.maxEntryBytes) }));
            }
            totalDeclared += info.originalSize;
            if (totalDeclared > limits.maxTotalBytes) {
                throw new ZipLimitError(i18n.t("ui.zipTooLarge", { limit: formatLimitBytes(limits.maxTotalBytes) }));
            }
            return true;
        },
    });
    let totalActual = 0;
    for (const [name, data] of Object.entries(entries)) {
        if (!isSafeZipEntryPath(name)) {
            throw new ZipLimitError(i18n.t("ui.zipInvalidPath"));
        }
        if (data.byteLength > limits.maxEntryBytes) {
            throw new ZipLimitError(i18n.t("ui.zipEntryTooLarge", { limit: formatLimitBytes(limits.maxEntryBytes) }));
        }
        totalActual += data.byteLength;
        if (totalActual > limits.maxTotalBytes) {
            throw new ZipLimitError(i18n.t("ui.zipTooLarge", { limit: formatLimitBytes(limits.maxTotalBytes) }));
        }
    }
    return entries;
}

export async function readZip(file: Blob, limits: ReadZipLimits = MEDIA_ZIP_LIMITS) {
    const entries = await readZipEntries(file, limits);
    return new Map(Object.entries(entries).map(([name, data]) => [name, new Blob([data as Uint8Array<ArrayBuffer>])]));
}
