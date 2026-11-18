import { apiRequest, captureSession, jsonRequest } from "./client";
import i18n from "@/i18n";

export type AgentSkillScope = "user" | "builtin";
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
    revision: string;
};
export type AgentSkillDetail = {
    name: string;
    description: string;
    instructions: string;
    interface?: AgentSkillInterface | null;
    path: string;
    managed: boolean;
    revision: string;
};
export type AgentSkillInput = { name?: string; description: string; instructions: string; interface?: AgentSkillInterface | null; expectedRevision?: string };
export type AgentSkillDraft = { name: string; displayName: string; description: string; instructions: string; shortDescription: string; defaultPrompt: string };
export type AgentSkillDraftInput = { source: "conversation" | "canvas"; threadId: string; projectId?: string; model: string; parameters: Record<string, unknown> };
export type AgentSkillsResponse = { ok?: boolean; data?: AgentSkillSummary[]; errors?: unknown[] };
export type AgentSkillResponse = { ok?: boolean; data?: AgentSkillDetail };
export type AgentSkillDraftResponse = { ok?: boolean; data?: AgentSkillDraft };

export function resolveAgentMessageAssetUrl(value: string) {
    return value.startsWith("/api/assets/") ? value : "";
}
export const fetchAssistantSkills = () => apiRequest<AgentSkillsResponse>(`/assistant/skills?locale=${encodeURIComponent(i18n.resolvedLanguage || "zh-CN")}`);
export const fetchAssistantSkill = (name: string) => apiRequest<AgentSkillResponse>(`/assistant/skills/${encodeURIComponent(name)}?locale=${encodeURIComponent(i18n.resolvedLanguage || "zh-CN")}`);
export const createAssistantSkill = (input: AgentSkillInput) => apiRequest<AgentSkillResponse>("/assistant/skills", jsonRequest("POST", input));
export const updateAssistantSkill = (name: string, input: AgentSkillInput) => apiRequest<AgentSkillResponse>(`/assistant/skills/${encodeURIComponent(name)}`, jsonRequest("PUT", input));
export const deleteAssistantSkill = (name: string, expectedRevision: string) => apiRequest<void>(`/assistant/skills/${encodeURIComponent(name)}`, jsonRequest("DELETE", { expectedRevision }));
export function setAssistantSkillEnabled(skill: Pick<AgentSkillSummary, "name" | "revision">, enabled: boolean) {
    return apiRequest<AgentSkillResponse>(`/assistant/skills/${encodeURIComponent(skill.name)}`, jsonRequest("PUT", { enabled, expectedRevision: skill.revision }));
}
export async function createAssistantSkillDraft(input: AgentSkillDraftInput): Promise<AgentSkillDraftResponse> {
    const assertSession = captureSession();
    const queued = await apiRequest<{ turnId: string }>("/assistant/skill-drafts", jsonRequest("POST", input));
    return new Promise((resolve, reject) => {
        const source = new EventSource("/api/events");
        let checking = false, pending = false, settled = false;
        const check = async () => {
            if (settled) return;
            pending = true;
            if (checking) return; checking = true;
            try {
                while (pending && !settled) {
                pending = false;
                assertSession();
                const result = await apiRequest<AgentSkillDraftResponse & { status: string; error?: string }>(`/assistant/skill-drafts/${encodeURIComponent(queued.turnId)}`);
                assertSession();
                if (result.status === "succeeded") { settled = true; source.close(); resolve(result); }
                else if (["failed", "interrupted", "cancelled"].includes(result.status)) { settled = true; source.close(); reject(new Error(result.error)); }
                }
            } catch (error) { settled = true; source.close(); reject(error); }
            finally { checking = false; }
        };
        source.addEventListener("changed", () => void check());
        source.onerror = () => { if (source.readyState === EventSource.CLOSED) { source.close(); reject(new Error(i18n.t("errors.taskDisconnected"))); } };
        void check();
    });
}
