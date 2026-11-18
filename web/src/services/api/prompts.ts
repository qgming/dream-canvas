import { apiRequest, jsonRequest } from "./client";
import i18n from "@/i18n";

export type PromptScope = "all" | "builtin" | "user";
export type PromptType = "text" | "image" | "video";
export type Prompt = {
    id: string;
    title: string;
    description: string;
    prompt: string;
    type: PromptType;
    category: string;
    builtIn: boolean;
    version: number;
    createdAt: string;
    updatedAt: string;
};
export type PromptInput = Pick<Prompt, "title" | "description" | "prompt" | "type" | "category" | "version">;
export const ALL_PROMPTS_OPTION = "all";
export type PromptListResponse = { items: Prompt[]; categories: string[]; total: number };

export function fetchPrompts({ keyword = "", category = ALL_PROMPTS_OPTION, scope = "all", type = "all", page = 1, pageSize = 20 }: { keyword?: string; category?: string; scope?: PromptScope; type?: PromptType | "all"; page?: number; pageSize?: number } = {}) {
    const params = new URLSearchParams({ keyword, category, scope, type, locale: i18n.resolvedLanguage || "zh-CN", page: String(page), pageSize: String(pageSize) });
    return apiRequest<PromptListResponse>(`/prompts?${params}`);
}

export const fetchPrompt = (id: string) => apiRequest<Prompt>(`/prompts/${encodeURIComponent(id)}?locale=${encodeURIComponent(i18n.resolvedLanguage || "zh-CN")}`);
export const createPrompt = (input: PromptInput) => apiRequest<Prompt>("/prompts", jsonRequest("POST", input));
export const updatePrompt = (id: string, input: PromptInput) => apiRequest<Prompt>(`/prompts/${encodeURIComponent(id)}`, jsonRequest("PUT", input));
export const deletePrompt = (id: string, version: number) => apiRequest<void>(`/prompts/${encodeURIComponent(id)}`, jsonRequest("DELETE", { version }));

export function formatPromptDate(value: string, locale?: string) {
    if (!value || value.startsWith("0001-")) return "";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat(locale, { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
