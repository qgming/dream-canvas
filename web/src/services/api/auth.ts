import { apiRequest, jsonRequest } from "./client";

export type User = { id: string; username: string; role: "admin" | "user"; disabled: boolean; createdAt: string; updatedAt: string };
export type Session = { user: User; csrf: string };

export const getAuthStatus = () => apiRequest<{ initialized: boolean }>("/auth/status");
export const getSession = () => apiRequest<Session>("/auth/me");
export const login = (username: string, password: string) => apiRequest<Session>("/auth/login", jsonRequest("POST", { username, password }));
export const logout = () => apiRequest<void>("/auth/logout", { method: "POST" });
export const changePassword = (currentPassword: string, password: string) => apiRequest<void>("/auth/password", jsonRequest("POST", { currentPassword, password }));
export const listUsers = () => apiRequest<User[]>("/admin/users");
export const createUser = (input: { username: string; password: string; role: User["role"] }) => apiRequest<User>("/admin/users", jsonRequest("POST", input));
export const setUserDisabled = (id: string, disabled: boolean) => apiRequest<void>(`/admin/users/${encodeURIComponent(id)}`, jsonRequest("PATCH", { disabled }));
export const resetUserPassword = (id: string, password: string) => apiRequest<void>(`/admin/users/${encodeURIComponent(id)}/password`, jsonRequest("POST", { password }));
