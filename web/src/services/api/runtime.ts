import { apiRequest, jsonRequest } from "./client";

export type ExecutionPolicy = {
    enabled: boolean; assistantSlots: number; generationSlots: number; userSlots: number; transferSlots: number; previewSlots: number;
    connectSeconds: number; querySeconds: number; firstResponseSeconds: number; idleSeconds: number;
    textSeconds: number; imageSeconds: number; audioSeconds: number; pollSeconds: number;
    queryFailures: number; maxWaitSeconds: number; transferSeconds: number;
    downloadRetrySeconds: number[]; storageRetrySeconds: number[]; signedUrlSeconds: number;
    imageBytes: number; audioBytes: number; videoBytes: number; jsonBytes: number;
    scriptSeconds: number; scriptMemoryMiB: number; pointsPerYuan: string;
};
export type RuntimeRecord = { version: number; policy: ExecutionPolicy | null };
export const getRuntime = () => apiRequest<{ record: RuntimeRecord; suggested: ExecutionPolicy }>("/admin/runtime");
export const saveRuntime = (version: number, policy: ExecutionPolicy) => apiRequest<RuntimeRecord>("/admin/runtime", jsonRequest("PUT", { version, policy }));

export type StorageConfig = { id: string; name: string; provider: "r2" | "aliyun" | "tencent" | "qiniu" | "s3"; endpoint: string; bucket: string; region: string; pathStyle: boolean; default: boolean; version: number };
export type StorageInput = Omit<StorageConfig, "id"> & { accessKeyId?: string; accessKeySecret?: string };
export const listStorages = () => apiRequest<{ storage: StorageConfig; hasCredential: boolean }[]>("/admin/storages");
export const saveStorage = (id: string | undefined, input: StorageInput) => apiRequest<{ storage: StorageConfig; hasCredential: boolean }>(id ? `/admin/storages/${encodeURIComponent(id)}` : "/admin/storages", jsonRequest(id ? "PUT" : "POST", input));
export const deleteStorage = (id: string) => apiRequest<void>(`/admin/storages/${encodeURIComponent(id)}`, { method: "DELETE" });

export type UsageEntry = { id: string; userId: string; projectId?: string; taskId?: string; turnId?: string; channelId: string; modelId: string; capability: string; state: string; costState: string; corrected: boolean; usage: Record<string, unknown>; pricing: Record<string, unknown>; costMicros: string | null; originalCostMicros: string | null; currency: string; pointsMilli: string | null; createdAt: string };
export type UsageCorrection = { id: string; adminId: string; before: UsageEntry; after: UsageEntry; reason: string; createdAt: string };
export const getUsage = (admin = false, filters: Record<string, string> = {}) => apiRequest<{ entries: UsageEntry[]; costMicros: string; pointsMilli: string; unknownCostCount: number; unknownPointsCount: number }>(`${admin ? "/admin/usage" : "/usage"}?${new URLSearchParams(Object.entries(filters).filter(([, value]) => value))}`);
export const correctUsage = (id: string, input: { costMicros: string | null; pointsMilli: string | null; reason: string }) => apiRequest<void>(`/admin/usage/${encodeURIComponent(id)}/corrections`, jsonRequest("POST", input));
export const usageCorrections = (id: string) => apiRequest<UsageCorrection[]>(`/admin/usage/${encodeURIComponent(id)}/corrections`);
