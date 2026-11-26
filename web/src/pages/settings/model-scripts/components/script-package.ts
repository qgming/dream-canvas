import { strToU8, zipSync } from "fflate";
import { saveAs } from "file-saver";
import i18n from "@/i18n";
import { readZipEntries, SCRIPT_ZIP_LIMITS } from "@/lib/zip";

export const validScriptFile = (name: string) => typeof name === "string" && /\.(js|json)$/.test(name) && !/[\\:\u0000\r\n]/.test(name) && name.split("/").every((part) => part && part !== "." && part !== ".." && !part.startsWith("."));
export function scriptManifest(files: Record<string, string>) {
    const value = JSON.parse(files["script.json"] || "{}");
    value.entry ||= "adapter.js"; value.inputs ||= "inputs.json";
    if (value.schemaVersion !== 1 || typeof value.name !== "string" || !value.name.trim() || !["text", "image", "video", "audio"].includes(value.capability) || !validScriptFile(value.entry) || !Array.isArray(value.phases) || !validScriptFile(value.inputs) || !Array.isArray(JSON.parse(files[value.inputs] || "null"))) throw new Error(i18n.t("modelScripts.invalidPackage"));
    return value as { schemaVersion: number; name: string; description: string; capability: "text" | "image" | "video" | "audio"; inputs: string; entry: string; phases: string[]; features?: { tools?: boolean; streaming?: boolean }; auth?: { type: string; header?: string; prefix?: string } };
}

export async function importScriptPackage(file: File) {
    if (!file.name.toLowerCase().endsWith(".zip")) throw new Error(i18n.t("modelScripts.zipRequired"));
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const entries = Object.entries(await readZipEntries(file, SCRIPT_ZIP_LIMITS)).filter(([name]) => !name.endsWith("/")).map(([name, content]) => [name, decoder.decode(content)] as const);
    const manifest = entries.find(([name]) => name === "script.json") || entries.find(([name]) => name.endsWith("/script.json"));
    if (!manifest) throw new Error(i18n.t("modelScripts.invalidPackage"));
    const prefix = manifest[0].slice(0, -"script.json".length);
    if (entries.some(([name]) => !name.startsWith(prefix)) || new Set(entries.map(([name]) => name)).size !== entries.length) throw new Error(i18n.t("modelScripts.invalidPackage"));
    const files = Object.fromEntries(entries.map(([name, content]) => [name.slice(prefix.length), content]));
    if (Object.keys(files).some((name) => !validScriptFile(name))) throw new Error(i18n.t("modelScripts.invalidFilePath"));
    scriptManifest(files);
    return files;
}

export function exportScriptFiles(files: Record<string, string>, name: string) {
    const packageName = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim() || "model-script";
    saveAs(new Blob([zipSync(Object.fromEntries(Object.entries(files).map(([name, content]) => [`${packageName}/${name}`, strToU8(content)])), { level: 0 })], { type: "application/zip" }), `${packageName}.zip`);
}

