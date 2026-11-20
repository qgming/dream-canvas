import i18n from "@/i18n";
import { ApiError, apiRequest, jsonRequest } from "./client";

export type LogSettings = { version: number; enabled: boolean; development: boolean };
export type LogEntry = { time: string; level: string; msg: string; [key: string]: unknown };
export type LogPage = { entries: LogEntry[]; bytes: number; files: number; fileBytes: number; maxFiles: number; page: number; pageSize: number; total: number; nextCursor: string; storageError: "" | "write" | "cleanup" };
export const getLogSettings = () => apiRequest<LogSettings>("/admin/logging");
export const saveLogSettings = (settings: LogSettings) => apiRequest<LogSettings>("/admin/logging", jsonRequest("PUT", settings));
export const readLogs = async (page: number, pageSize: number, signal?: AbortSignal) => {
    const result = await apiRequest<LogPage>(`/admin/logging/entries?page=${page}&pageSize=${pageSize}`, { cache: "no-store", signal });
    if (!Number.isSafeInteger(result.total) || result.total < 0 || !Number.isSafeInteger(result.page) || result.page < 1 || result.pageSize !== pageSize) throw new ApiError(502, "log_pagination_unavailable", i18n.t("logging.errors.log_pagination_unavailable"));
    return result;
};
export const clearLogs = () => apiRequest<LogPage>("/admin/logging/entries", jsonRequest("DELETE", { confirmed: true }));
