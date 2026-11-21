import { create } from "zustand";
import i18n from "@/i18n";

import { fetchAssistantSkills, type AgentSkillDraft, type AgentSkillSummary } from "@/services/api/assistant-skills";
import { useAgentStore } from "@/stores/use-agent-store";

let loadSequence = 0;

type AgentSkillStore = {
    skills: AgentSkillSummary[];
    selectedSkill: AgentSkillSummary | null;
    selectionRevision: number;
    connectionRevision: number;
    draft: AgentSkillDraft | null;
    generatingSource: "conversation" | "canvas" | null;
    loading: boolean;
    loaded: boolean;
    errors: string[];
    loadSkills: () => Promise<void>;
    selectSkill: (skill: AgentSkillSummary | null, prompt?: string) => void;
    clearSelection: (expectedRevision?: number) => void;
    setDraft: (draft: AgentSkillDraft | null) => void;
    setGeneratingSource: (source: "conversation" | "canvas" | null) => void;
    reset: () => void;
};

export const useAgentSkillStore = create<AgentSkillStore>((set, get) => ({
    skills: [],
    selectedSkill: null,
    selectionRevision: 0,
    connectionRevision: 0,
    draft: null,
    generatingSource: null,
    loading: false,
    loaded: false,
    errors: [],
    loadSkills: async () => {
        const sequence = ++loadSequence;
        set({ loading: true });
        try {
            const response = await fetchAssistantSkills();
            if (sequence !== loadSequence) return;
            const skills = response.data || [];
            const current = get();
            const selected = current.selectedSkill;
            const selectedSkill = selected ? skills.find((item) => item.name === selected.name && item.path === selected.path && item.enabled) || null : null;
            const selectionChanged = Boolean(selected && !selectedSkill);
            if (selectionChanged) clearSelectedSkillPrompt(selected);
            set({ skills, selectedSkill, selectionRevision: current.selectionRevision + (selectionChanged ? 1 : 0), loading: false, loaded: true, errors: (response.errors || []).map(skillErrorText) });
        } catch (error) {
            if (sequence !== loadSequence) return;
            set({ loading: false, loaded: true, errors: [error instanceof Error ? error.message : i18n.t("agent.state.skillReadFailed")] });
        }
    },
    selectSkill: (selectedSkill, prompt) => {
        const current = get();
        const agent = useAgentStore.getState();
        const marker = selectedSkill ? `$${selectedSkill.name}` : "";
        const previousMarker = current.selectedSkill ? `$${current.selectedSkill.name}` : "";
        let nextPrompt = prompt;
        if (nextPrompt === undefined && selectedSkill) {
            if (!agent.prompt.trim()) {
                nextPrompt = `${marker} `;
            } else if (previousMarker && agent.prompt.includes(previousMarker)) {
                nextPrompt = agent.prompt.replace(previousMarker, marker);
            } else {
                nextPrompt = agent.prompt.includes(marker) ? agent.prompt : `${agent.prompt}${/\s$/.test(agent.prompt) ? "" : " "}${marker} `;
            }
        }
        if (nextPrompt !== undefined && agent.prompt !== nextPrompt) agent.setAgentState({ prompt: nextPrompt });
        set({ selectedSkill, selectionRevision: current.selectionRevision + 1 });
    },
    clearSelection: (expectedRevision) => {
        const current = get();
        if (expectedRevision !== undefined && expectedRevision !== current.selectionRevision) return;
        clearSelectedSkillPrompt(current.selectedSkill);
        set({ selectedSkill: null, selectionRevision: current.selectionRevision + 1 });
    },
    setDraft: (draft) => set({ draft }),
    setGeneratingSource: (generatingSource) => set({ generatingSource }),
    reset: () => {
        loadSequence += 1;
        const current = get();
        clearSelectedSkillPrompt(current.selectedSkill);
        set({ skills: [], selectedSkill: null, selectionRevision: current.selectionRevision + 1, connectionRevision: current.connectionRevision + 1, draft: null, generatingSource: null, loading: false, loaded: false, errors: [] });
    },
}));

function clearSelectedSkillPrompt(skill: AgentSkillSummary | null) {
    if (!skill) return;
    const agent = useAgentStore.getState();
    const prompt = agent.prompt.replace(`$${skill.name}`, "");
    if (agent.prompt !== prompt) agent.setAgentState({ prompt: prompt.trim() ? prompt : "" });
}

function skillErrorText(value: unknown) {
    if (typeof value === "string") return value;
    if (!value || typeof value !== "object") return i18n.t("agent.state.skillParseFailed");
    const item = value as { path?: unknown; error?: unknown; message?: unknown };
    const message = typeof item.error === "string" ? item.error : typeof item.message === "string" ? item.message : i18n.t("agent.state.skillParseFailed");
    return typeof item.path === "string" ? `${item.path}：${message}` : message;
}
