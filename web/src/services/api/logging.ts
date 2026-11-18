import { apiRequest, jsonRequest } from "./client";

export type LogSettings = { version: number; enabled: boolean; development: boolean };
export const getLogSettings = () => apiRequest<LogSettings>("/admin/logging");
export const saveLogSettings = (settings: LogSettings) => apiRequest<LogSettings>("/admin/logging", jsonRequest("PUT", settings));
