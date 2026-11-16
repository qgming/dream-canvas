import { apiRequest, jsonRequest } from "./client";

type RecordValue<T> = { id: string; version: number; value: T };
export const readWorkbenchRecords = async <T>(kind: "image" | "video") => (await apiRequest<RecordValue<T>[]>(`/workbench/${kind}/records`)).map((record) => ({ ...record.value, recordVersion: record.version }));
export const saveWorkbenchRecord = async <T extends { id: string; recordVersion?: number }>(kind: "image" | "video", value: T) => {
    const { recordVersion, ...data } = value;
    const record = await apiRequest<RecordValue<T>>(`/workbench/${kind}/records/${encodeURIComponent(value.id)}`, jsonRequest("PUT", { value: data, version: recordVersion || 0 }));
    return { ...record.value, recordVersion: record.version };
};
export const deleteWorkbenchRecord = (kind: "image" | "video", id: string) => apiRequest<void>(`/workbench/${kind}/records/${encodeURIComponent(id)}`, { method: "DELETE" });
