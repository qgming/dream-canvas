import { apiRequest, jsonRequest } from "./client";

export type ExecutionPolicy = {
    enabled: boolean; assistantSlots: number; generationSlots: number; userSlots: number; transferSlots: number; previewSlots: number;
    connectSeconds: number; querySeconds: number; firstResponseSeconds: number; idleSeconds: number;
    textSeconds: number; imageSeconds: number; audioSeconds: number; pollSeconds: number;
    queryFailures: number; maxWaitSeconds: number; transferSeconds: number;
    downloadRetrySeconds: number[]; storageRetrySeconds: number[]; signedUrlSeconds: number;
    imageBytes: number; audioBytes: number; videoBytes: number; jsonBytes: number;
    scriptSeconds: number; scriptMemoryMiB: number;
};
export type RuntimeRecord = { version: number; policy: ExecutionPolicy | null };
export const getRuntime = () => apiRequest<{ record: RuntimeRecord; suggested: ExecutionPolicy }>("/admin/runtime");
export const saveRuntime = (version: number, policy: ExecutionPolicy) => apiRequest<RuntimeRecord>("/admin/runtime", jsonRequest("PUT", { version, policy }));

export type StorageConfig = { id: string; name: string; provider: "r2" | "aliyun" | "tencent" | "qiniu" | "s3"; endpoint: string; bucket: string; region: string; pathStyle: boolean; default: boolean; version: number };
export type StorageInput = Omit<StorageConfig, "id"> & { accessKeyId?: string; accessKeySecret?: string };
export const listStorages = () => apiRequest<{ storage: StorageConfig; hasCredential: boolean }[]>("/admin/storages");
export const saveStorage = (id: string | undefined, input: StorageInput) => apiRequest<{ storage: StorageConfig; hasCredential: boolean }>(id ? `/admin/storages/${encodeURIComponent(id)}` : "/admin/storages", jsonRequest(id ? "PUT" : "POST", input));
export const deleteStorage = (id: string) => apiRequest<void>(`/admin/storages/${encodeURIComponent(id)}`, { method: "DELETE" });

export type UsageEntry = { id: string; userId: string; projectId?: string; taskId?: string; turnId?: string; channelId: string; modelId: string; capability: string; state: string; usage: Record<string, unknown>; startedAt: string; createdAt: string; updatedAt: string };
export type UsageModelSummary = { channelId: string; modelId: string; capability: string; callCount: number; pendingCount: number };
export type UsageSummary = { callCount: number; pendingCount: number; byModel: UsageModelSummary[] };
export const getUsage = (admin = false, filters: Record<string, string> = {}) => apiRequest<{ entries: UsageEntry[]; summary: UsageSummary }>(`${admin ? "/admin/usage" : "/usage"}?${new URLSearchParams(Object.entries(filters).filter(([, value]) => value))}`);
