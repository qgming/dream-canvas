import type { RawPrompt } from "./prompt-source-runtime";
import { apiRequest, captureSession } from "./client";
import { usePromptSourceStore } from "@/stores/use-prompt-source-store";

export type Prompt = RawPrompt & { sourceId: string; category: string; githubUrl: string };
export const ALL_PROMPTS_OPTION = "all";
export type PromptListResponse = { items: Prompt[]; tags: string[]; categories: string[]; total: number };
export type PromptSourceStatus = { sourceId: string; count: number; lastSuccessAt: string | null; lastError: string };
export type PromptSourceRefreshResult = PromptSourceStatus & { sourceName: string; success: boolean };
export type PromptSourceRefreshSummary = { results: PromptSourceRefreshResult[]; total: number; successCount: number; failureCount: number };
type SourceRecord = PromptSourceStatus & { items: Prompt[] };
const enabledSources = () => usePromptSourceStore.getState().sources.filter((source) => source.enabled);
const sourcePath = (id: string) => `/prompts/sources/${encodeURIComponent(id)}`;

export const fetchSourcePrompts = async (id: string): Promise<Prompt[]> => (await apiRequest<SourceRecord>(sourcePath(id))).items;

export async function fetchPrompts({ keyword = "", tag = [], category = ALL_PROMPTS_OPTION, page = 1, pageSize = 20 }: { keyword?: string; tag?: string[]; category?: string; page?: number; pageSize?: number } = {}): Promise<PromptListResponse> {
    const assertSession = captureSession();
    const sources = enabledSources();
    const items = (await Promise.all(sources.map((source) => fetchSourcePrompts(source.id)))).flat();
    assertSession();
    const search = keyword.trim().toLowerCase();
    const base = items.filter((item) => (!category || category === ALL_PROMPTS_OPTION || item.category === category) && (!search || [item.title, item.prompt, item.description, item.category, ...item.tags].join(" ").toLowerCase().includes(search)));
    const filtered = base.filter((item) => !tag.length || tag.some((value) => item.tags.includes(value)));
    const size = Math.max(1, Math.min(100, pageSize));
    return { items: filtered.slice((Math.max(1, page) - 1) * size, Math.max(1, page) * size), tags: [...new Set(base.flatMap((item) => item.tags).filter(Boolean))], categories: sources.map((source) => source.name), total: filtered.length };
}

export async function refreshSource(id: string): Promise<PromptSourceRefreshResult> {
    const row = await apiRequest<SourceRecord>(`${sourcePath(id)}/refresh`, { method: "POST" });
    return { ...row, sourceName: usePromptSourceStore.getState().sources.find((source) => source.id === id)?.name || id, success: true };
}

export async function fetchPromptSourceStatuses(): Promise<Record<string, PromptSourceStatus>> {
    return Object.fromEntries((await apiRequest<PromptSourceStatus[]>("/prompts/sources/statuses")).map((row) => [row.sourceId, row]));
}

async function refreshSources(ids: string[]): Promise<PromptSourceRefreshSummary> {
    const assertSession = captureSession();
    const results = await Promise.all(ids.map(async (id): Promise<PromptSourceRefreshResult> => {
        try { return await refreshSource(id); }
        catch (error) { return { sourceId: id, sourceName: usePromptSourceStore.getState().sources.find((source) => source.id === id)?.name || id, count: 0, lastSuccessAt: null, lastError: error instanceof Error ? error.message : String(error), success: false }; }
    }));
    assertSession();
    return { results, total: results.reduce((sum, row) => sum + row.count, 0), successCount: results.filter((row) => row.success).length, failureCount: results.filter((row) => !row.success).length };
}

export const refreshAllSources = () => refreshSources(enabledSources().map((source) => source.id));
export function formatPromptDate(value: string, locale?: string) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat(locale, { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
