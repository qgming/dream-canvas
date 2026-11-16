import { apiRequest, jsonRequest } from "./client";

export type Capability = "text" | "image" | "video" | "audio";
export type ParameterControl = { key: string; label: string; type: "text" | "textarea" | "number" | "switch" | "select" | "asset"; required?: boolean; default?: unknown; options?: { label: string; value: unknown }[]; role?: "image" | "video" | "audio" };
export type ServerModel = { id: string; channelId: string; model: string; name: string; capability: Capability; protocol: string; enabled: boolean; version: number; parameters: ParameterControl[]; pricing: Record<string, unknown>; publishedVersionId?: string };
export type ServerChannel = { id: string; name: string; baseUrl: string; enabled: boolean; version: number };
export type ChannelEntry = { channel: ServerChannel; hasCredential: boolean; models: ServerModel[] };
export type CatalogChannel = { id: string; name: string; models: Pick<ServerModel, "id" | "model" | "name" | "capability" | "parameters" | "pricing" | "version">[] };
export type InterfaceScripts = Record<"submit" | "query" | "result" | "usage" | "cancel", string>;
export type InterfaceDraft = { modelId: string; revision: number; scripts: InterfaceScripts; parameters: ParameterControl[] };
export type InterfaceVersion = { id: string; draftRevision: number; scripts: InterfaceScripts; parameters: ParameterControl[]; verified: boolean; createdAt: string };

export const listChannels = () => apiRequest<ChannelEntry[]>("/admin/channels");
export const modelCatalog = () => apiRequest<CatalogChannel[]>("/catalog");
export const saveChannel = (id: string | undefined, input: Omit<ServerChannel, "id"> & { credential?: string }) => apiRequest<{ channel: ServerChannel; hasCredential: boolean }>(id ? `/admin/channels/${encodeURIComponent(id)}` : "/admin/channels", jsonRequest(id ? "PUT" : "POST", input));
export const saveModel = (channelId: string, id: string | undefined, input: Omit<ServerModel, "id" | "channelId">) => apiRequest<ServerModel>(`/admin/channels/${encodeURIComponent(channelId)}/models${id ? `/${encodeURIComponent(id)}` : ""}`, jsonRequest(id ? "PUT" : "POST", input));
export const getInterface = (id: string) => apiRequest<{ draft: InterfaceDraft; versions: InterfaceVersion[] }>(`/admin/models/${encodeURIComponent(id)}/interface`);
export const saveInterface = (id: string, draft: InterfaceDraft) => apiRequest<InterfaceDraft>(`/admin/models/${encodeURIComponent(id)}/interface`, jsonRequest("PUT", draft));
export const publishInterface = (id: string, revision: number, modelVersion: number) => apiRequest<InterfaceVersion>(`/admin/models/${encodeURIComponent(id)}/interface/publish`, jsonRequest("POST", { revision, modelVersion }));
