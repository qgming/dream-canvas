import { apiRequest, jsonRequest } from "./client";
import type { CanvasNodeMetadata } from "@/types/canvas";

export type CanvasNodeSpec = { type: string; title: string; defaultSize: { width: number; height: number }; defaultMetadata?: CanvasNodeMetadata };
export type CanvasPluginRecord = { id: string; name: string; description: string; builtin: boolean; enabled: boolean; version: number; publishedVersionId: string; nodes: CanvasNodeSpec[] };
export type CanvasPluginCatalogEntry = CanvasPluginRecord & { source?: string };

const pluginPath = (id: string) => `/admin/canvas-plugins/${encodeURIComponent(id)}`;
export const canvasPluginCatalog = () => apiRequest<CanvasPluginCatalogEntry[]>("/canvas-plugins");
export const listCanvasPlugins = () => apiRequest<CanvasPluginRecord[]>("/admin/canvas-plugins");
export const setCanvasPluginEnabled = (id: string, version: number, enabled: boolean) => apiRequest<CanvasPluginRecord>(`${pluginPath(id)}/enabled`, jsonRequest("PUT", { version, enabled }));
