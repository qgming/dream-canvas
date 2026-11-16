import { apiRequest, captureSession, jsonRequest } from "./client";
import type { AgentReasoningEffort } from "@/stores/use-agent-store";

export type AgentSkillScope = "user" | "repo" | "system" | "admin";
export type AgentSkillInterface = { displayName?: string | null; shortDescription?: string | null; defaultPrompt?: string | null };
export type AgentSkillSummary = {
    name: string;
    description: string;
    shortDescription?: string | null;
    interface?: AgentSkillInterface | null;
    dependencies?: unknown;
    path: string;
    scope: AgentSkillScope;
    enabled: boolean;
    managed: boolean;
};
export type AgentSkillDetail = {
    name: string;
    description: string;
    instructions: string;
    interface?: AgentSkillInterface | null;
    path: string;
    managed: true;
    revision: string;
};
export type AgentSkillInput = { name?: string; description: string; instructions: string; interface?: AgentSkillInterface | null; expectedRevision?: string };
export type AgentSkillDraft = { name: string; displayName: string; description: string; instructions: string; shortDescription: string; defaultPrompt: string };
export type AgentSkillDraftInput = { source: "conversation" | "canvas"; threadId: string; clientId: string; model?: string; effort?: AgentReasoningEffort };
export type AgentSkillsResponse = { ok?: boolean; data?: AgentSkillSummary[]; errors?: unknown[] };
export type AgentSkillResponse = { ok?: boolean; data?: AgentSkillDetail };
export type AgentSkillDraftResponse = { ok?: boolean; data?: AgentSkillDraft };

export function resolveAgentMessageAssetUrl(_endpoint: string, _token: string, value: string) {
    return value.startsWith("/api/assets/") ? value : "";
}
export const fetchCodexSkills = (_endpoint: string, _token: string, _forceReload = false) => apiRequest<AgentSkillsResponse>("/assistant/skills");
export const fetchCodexSkill = (_endpoint: string, _token: string, name: string) => apiRequest<AgentSkillResponse>(`/assistant/skills/${encodeURIComponent(name)}`);
export const createCodexSkill = (_endpoint: string, _token: string, input: AgentSkillInput) => apiRequest<AgentSkillResponse>("/assistant/skills", jsonRequest("POST", input));
export const updateCodexSkill = (_endpoint: string, _token: string, name: string, input: AgentSkillInput) => apiRequest<AgentSkillResponse>(`/assistant/skills/${encodeURIComponent(name)}`, jsonRequest("PUT", input));
export const deleteCodexSkill = (_endpoint: string, _token: string, name: string, expectedRevision: string) => apiRequest<void>(`/assistant/skills/${encodeURIComponent(name)}`, jsonRequest("DELETE", { expectedRevision }));
export async function setCodexSkillEnabled(endpoint: string, token: string, skill: Pick<AgentSkillSummary, "name" | "path">, enabled: boolean) {
    const assertSession = captureSession();
    const record = await fetchCodexSkill(endpoint, token, skill.name);
    assertSession();
    return apiRequest<AgentSkillResponse>(`/assistant/skills/${encodeURIComponent(skill.name)}`, jsonRequest("PUT", { enabled, expectedRevision: record.data?.revision }));
}
export const createCodexSkillDraft = (_endpoint: string, _token: string, input: AgentSkillDraftInput & { projectId?: string }) => apiRequest<AgentSkillDraftResponse>("/assistant/skill-drafts", jsonRequest("POST", input));
