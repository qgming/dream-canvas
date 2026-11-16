import { create } from "zustand";
import localforage from "localforage";
import { getPreference, savePreference } from "@/services/api/preferences";
import { captureSession } from "@/services/api/client";
import { useAuthStore } from "@/stores/use-auth-store";

import { DEFAULT_PROMPT_SOURCES, createPromptSource, type PromptSource } from "@/services/api/prompt-source-presets";

export type PromptSourceSchedule = {
    intervalMinutes: number;
    lastFetchedAt: string;
};

const defaultSchedule: PromptSourceSchedule = {
    intervalMinutes: 30,
    lastFetchedAt: "",
};

export const PROMPT_SOURCE_INTERVALS = [0, 30, 60, 360, 1440];

type PromptSourceStore = {
    hydrated: boolean;
    version: number;
    dirty: boolean;
    saving: boolean;
    error: string;
    reset: () => void;
    load: (discardDraft?: boolean) => Promise<void>;
    save: () => Promise<void>;
    sources: PromptSource[];
    schedule: PromptSourceSchedule;
    addSource: () => PromptSource;
    saveSource: (source: PromptSource) => void;
    removeSource: (id: string) => void;
    toggleSource: (id: string, enabled: boolean) => void;
    updateSchedule: <K extends keyof PromptSourceSchedule>(key: K, value: PromptSourceSchedule[K]) => void;
};

type SourcePreference = { sources: PromptSource[]; schedule: PromptSourceSchedule };
type SourceDraft = { value: SourcePreference; version: number };
const drafts = localforage.createInstance({ name: "dream-canvas", storeName: "unsaved-prompt-sources" });
let pendingWrite = Promise.resolve();
let running: Promise<void> | null = null;
let scope = 0;
let edits = 0;

function persistDraft() {
    const owner = useAuthStore.getState().user?.id;
    const { sources, schedule, version } = usePromptSourceStore.getState();
    if (!owner) return;
    pendingWrite = pendingWrite.catch(() => undefined).then(async () => { await drafts.setItem(owner, { value: { sources, schedule }, version }); });
    void pendingWrite.catch((error: unknown) => { if (useAuthStore.getState().user?.id === owner) usePromptSourceStore.setState({ error: error instanceof Error ? error.message : "来源配置暂存失败" }); });
}

export const usePromptSourceStore = create<PromptSourceStore>((set, get) => ({
            hydrated: false, version: 0, dirty: false, saving: false, error: "",
            reset: () => { scope++; running = null; set({ hydrated: false, sources: DEFAULT_PROMPT_SOURCES, schedule: defaultSchedule, version: 0, dirty: false, saving: false, error: "" }); },
            load: async (discardDraft = false) => {
                const owner = useAuthStore.getState().user?.id;
                if (!owner) return;
                const assertSession = captureSession();
                const changed = edits;
                await running;
                try { assertSession(); } catch { return; }
                const revision = ++scope;
                try {
                    const record = await getPreference<SourcePreference>("prompt-sources");
                    await pendingWrite.catch(() => undefined);
                    if (revision !== scope || useAuthStore.getState().user?.id !== owner) return;
                    if (changed !== edits) throw new Error("读取期间来源配置又发生修改，当前编辑仍保留");
                    if (discardDraft) {
                        pendingWrite = pendingWrite.catch(() => undefined).then(async () => { assertSession(); if (changed !== edits) throw new Error("读取期间来源配置又发生修改，当前编辑仍保留"); await drafts.removeItem(owner); });
                        await pendingWrite;
                    }
                    const draft = discardDraft ? null : await drafts.getItem<SourceDraft>(owner);
                    assertSession();
                    if (revision !== scope) return;
                    if (changed !== edits) throw new Error("读取期间来源配置又发生修改，当前编辑仍保留");
                    set({ sources: draft?.value.sources || record.value?.sources || DEFAULT_PROMPT_SOURCES, schedule: draft?.value.schedule || record.value?.schedule || defaultSchedule, hydrated: true, version: draft?.version ?? record.version, dirty: Boolean(draft), error: draft ? "已恢复未保存的来源配置；版本冲突时请先保留需要的内容再重新读取。" : "" });
                } catch (error) { if (revision === scope) set({ error: error instanceof Error ? error.message : "读取提示词配置失败" }); }
            },
            save: () => {
                if (running) return running;
                if (!get().hydrated || !get().dirty) return Promise.resolve();
                const owner = useAuthStore.getState().user?.id;
                if (!owner) return Promise.resolve();
                const assertSession = captureSession();
                const revision = scope;
                const operation = (async () => {
                    set({ saving: true });
                    try {
                        await pendingWrite;
                        assertSession();
                        if (revision !== scope) return;
                        const changed = edits;
                        const { sources, schedule, version } = get();
                        const record = await savePreference("prompt-sources", { sources, schedule }, version);
                        if (revision !== scope) return;
                        set({ version: record.version, dirty: changed !== edits, error: "" });
                        const latest: SourceDraft = { value: { sources: get().sources, schedule: get().schedule }, version: record.version };
                        const dirty = get().dirty;
                        pendingWrite = pendingWrite.catch(() => undefined).then(async () => { if (dirty) await drafts.setItem(owner, latest); else await drafts.removeItem(owner); });
                        await pendingWrite;
                    } catch (error) { if (revision === scope) set({ error: error instanceof Error ? error.message : "保存失败，当前编辑仍保留" }); }
                    finally { if (revision === scope) set({ saving: false }); }
                })();
                running = operation;
                void operation.finally(() => { if (running === operation) running = null; });
                return operation;
            },
            sources: DEFAULT_PROMPT_SOURCES,
            schedule: defaultSchedule,
            addSource: () => createPromptSource(),
            saveSource: (source) => { if (!get().hydrated) return; edits++; set((state) => ({
                    dirty: true,
                    sources: state.sources.some((item) => item.id === source.id)
                        ? state.sources.map((item) => (item.id === source.id && !item.builtIn ? createPromptSource(source) : item))
                        : [...state.sources, createPromptSource(source)],
                })); persistDraft(); },
            removeSource: (id) => { if (!get().hydrated) return; edits++; set((state) => ({ dirty: true, sources: state.sources.filter((item) => item.id !== id || item.builtIn) })); persistDraft(); },
            toggleSource: (id, enabled) => { if (!get().hydrated) return; edits++; set((state) => ({ dirty: true, sources: state.sources.map((item) => (item.id === id ? { ...item, enabled } : item)) })); persistDraft(); },
            updateSchedule: (key, value) => { if (!get().hydrated) return; edits++; set((state) => ({ dirty: true, schedule: { ...state.schedule, [key]: value } })); persistDraft(); },
}));
