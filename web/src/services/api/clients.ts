import { apiRequest, jsonRequest } from "./client";
import type { ViewportTransform } from "@/types/canvas";

export type ClientState = { id: string; projectId: string; title: string; revision: number; selectedNodeIds: string[]; nodeIds: string[]; viewport: ViewportTransform };
export type ClientCommand = { id: string; clientId: string; projectId: string; revision: number; kind: string; value: { nodeIds?: string[]; viewport?: ViewportTransform; projectId?: string } };
export const publishClient = (state: ClientState, registration: number) => apiRequest<void>("/clients", jsonRequest("POST", { ...state, registration }));
export const acknowledgeClient = (clientId: string, commandId: string, accepted: boolean, projectId?: string) => apiRequest<void>(`/clients/${encodeURIComponent(clientId)}/commands/${encodeURIComponent(commandId)}`, jsonRequest("POST", { accepted, projectId }));
export const removeClient = (clientId: string, registration: number) => apiRequest<void>(`/clients/${encodeURIComponent(clientId)}`, { ...jsonRequest("DELETE", { registration }), keepalive: true });
