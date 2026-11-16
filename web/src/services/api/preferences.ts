import { apiRequest, jsonRequest } from "./client";

export type Preference<T> = { version: number; value: T | null };
export const getPreference = <T>(name: "generation" | "prompt-sources") => apiRequest<Preference<T>>(`/preferences/${name}`);
export const savePreference = <T>(name: "generation" | "prompt-sources", value: T, version: number) => apiRequest<Preference<T>>(`/preferences/${name}`, jsonRequest("PUT", { value, version }));
