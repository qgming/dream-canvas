import { apiRequest, jsonRequest } from "./client";

export const scriptRuntimeFields = ["initSeconds", "submitSeconds", "resultSeconds", "streamEventSeconds", "firstResponseSeconds", "idleSeconds", "memoryMiB", "jsonLimitMiB"] as const;
type ScriptRuntimeField = typeof scriptRuntimeFields[number];
type ExecutionRange = { min: number; max: number; default: number };
type SiteSettingsInput = { version: number; open: boolean; assistantSlots: number; generationSlots: number; userSlots: number; scriptRuntime: Record<ScriptRuntimeField, number> };
export type SiteSettings = SiteSettingsInput & { scriptRuntimeBounds: Record<ScriptRuntimeField, ExecutionRange> };
export const getSiteSettings = () => apiRequest<SiteSettings>("/admin/site");
export const saveSiteSettings = ({ scriptRuntimeBounds: _, ...settings }: SiteSettings, confirmed = false) => apiRequest<SiteSettings>("/admin/site", jsonRequest("PUT", { ...settings, confirmed }));

export type StorageConfig = { id: string; name: string; provider: "r2" | "aliyun" | "tencent" | "qiniu" | "s3"; endpoint: string; bucket: string; region: string; pathStyle: boolean; default: boolean; version: number };
export type StorageInput = Omit<StorageConfig, "id"> & { accessKeyId?: string; accessKeySecret?: string };
export const listStorages = () => apiRequest<{ storage: StorageConfig; hasCredential: boolean }[]>("/admin/storages");
export const saveStorage = (id: string | undefined, input: StorageInput) => apiRequest<{ storage: StorageConfig; hasCredential: boolean }>(id ? `/admin/storages/${encodeURIComponent(id)}` : "/admin/storages", jsonRequest(id ? "PUT" : "POST", input));
export type StorageTestResult = { success: boolean; stage: "write" | "read" | "verify" | "delete" | "completed"; code?: string; httpStatus?: number; cleanupRequired?: boolean; cleanupCode?: string; cleanupHttpStatus?: number; objectKey?: string; versionId?: string };
export const testStorage = (id: string | undefined, input: StorageInput) => apiRequest<StorageTestResult>("/admin/storages/test", jsonRequest("POST", { storageId: id, config: input }));
export const deleteStorage = (id: string) => apiRequest<void>(`/admin/storages/${encodeURIComponent(id)}`, { method: "DELETE" });

export type UsageModelSummary = { channelId: string; modelId: string; capability: string; callCount: number };
export type UsageSummary = { callCount: number; byModel: UsageModelSummary[] };
export const getUsage = (admin = false, filters: Record<string, string> = {}) => apiRequest<{ summary: UsageSummary }>(`${admin ? "/admin/usage" : "/usage"}?${new URLSearchParams(Object.entries(filters).filter(([, value]) => value))}`);
