import { apiRequest, jsonRequest } from "./client";

export type AccessToken = { id: string; name: string; scopes: string[]; projects: string[]; revoked: boolean; createdAt: string };
export const listTokens = () => apiRequest<AccessToken[]>("/tokens");
export const createToken = (input: { name: string; scopes: string[]; projects: string[] }) => apiRequest<{ token: string; record: AccessToken }>("/tokens", jsonRequest("POST", input));
export const revokeToken = (id: string) => apiRequest<void>(`/tokens/${encodeURIComponent(id)}/revoke`, { method: "POST" });
