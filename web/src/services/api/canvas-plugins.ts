import { apiRequest, jsonRequest } from "./client";
import type { CanvasNodeMetadata } from "@/types/canvas";

export type CanvasNodeSpec = { type: string; title: string; defaultSize: { width: number; height: number }; defaultMetadata?: CanvasNodeMetadata };
export type CanvasPluginRecord = { id: string; name: string; description: string; builtin: boolean; enabled: boolean; version: number; publishedVersionId: string; nodes: CanvasNodeSpec[] };
export type CanvasPluginCatalogEntry = CanvasPluginRecord & { source?: string };
export type CanvasPluginDraft = { pluginId: string; revision: number; files: Record<string, string> };
export type CanvasPluginVersion = { id: string; revision: number; files: Record<string, string>; createdAt: string };
export type CanvasPluginDetail = { plugin: CanvasPluginRecord; draft?: CanvasPluginDraft; versions: CanvasPluginVersion[] };

const pluginPath = (id: string) => `/admin/canvas-plugins/${encodeURIComponent(id)}`;
export const canvasPluginCatalog = () => apiRequest<CanvasPluginCatalogEntry[]>("/canvas-plugins");
export const listCanvasPlugins = () => apiRequest<CanvasPluginRecord[]>("/admin/canvas-plugins");
export const getCanvasPlugin = (id: string) => apiRequest<CanvasPluginDetail>(pluginPath(id));
export const getCanvasPluginContract = (locale = "zh-CN") => apiRequest<Record<string, string>>(`/admin/canvas-plugin-contract?locale=${encodeURIComponent(locale)}`);
export const createCanvasPlugin = (input: { name: string; description: string }) => apiRequest<CanvasPluginRecord>("/admin/canvas-plugins", jsonRequest("POST", input));
export const saveCanvasPluginDraft = (id: string, revision: number, files: Record<string, string>) => apiRequest<CanvasPluginDraft>(`${pluginPath(id)}/draft`, jsonRequest("PUT", { revision, files }));
export const publishCanvasPlugin = (id: string, revision: number, version: number) => apiRequest<CanvasPluginRecord>(`${pluginPath(id)}/publish`, jsonRequest("POST", { revision, version, confirmed: true }));
export const setCanvasPluginEnabled = (id: string, version: number, enabled: boolean) => apiRequest<CanvasPluginRecord>(`${pluginPath(id)}/enabled`, jsonRequest("PUT", { version, enabled }));
export const deleteCanvasPlugin = (id: string, version: number) => apiRequest<void>(pluginPath(id), jsonRequest("DELETE", { version, confirmed: true }));
