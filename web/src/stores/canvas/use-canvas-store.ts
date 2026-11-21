import { create } from "zustand";
import localforage from "localforage";
import { nanoid } from "nanoid";
import { dequal } from "dequal";

import i18n from "@/i18n";
import { ApiError, captureSession } from "@/services/api/client";
import * as api from "@/services/api/projects";
import { useAuthStore } from "@/stores/use-auth-store";
import { canvasProjectSchema } from "@/lib/canvas/project-schema";
import { projectChanges, rebaseProject } from "@/lib/canvas/project-sync";
import { assignCanvasNodeIdentities } from "@/lib/canvas/canvas-node-identity";
import type { CanvasBackgroundMode } from "@/lib/canvas-theme";
import type { CanvasAssistantSession, CanvasConnection, CanvasNodeData, ViewportTransform } from "@/types/canvas";

export type CanvasProject = {
    id: string; title: string; version: number; createdAt: string; updatedAt: string;
    nodes: CanvasNodeData[]; connections: CanvasConnection[];
    chatSessions: CanvasAssistantSession[]; activeChatId: string | null;
    backgroundMode: CanvasBackgroundMode; showImageInfo: boolean; viewport: ViewportTransform;
};
type SaveState = { status: "saving" | "saved" | "conflict" | "error"; message?: string };
type History = { past: number[]; future: number[]; head: number };
type CanvasStore = {
    hydrated: boolean; projects: CanvasProject[]; bases: Record<string, CanvasProject>; saves: Record<string, SaveState>;
    histories: Record<string, History>; error: string;
    reset: () => void; loadProjects: () => Promise<void>; refreshProjects: () => Promise<void>;
    createProject: (title?: string) => Promise<string>; importProject: (project: Partial<CanvasProject>) => Promise<string>;
    openProject: (id: string) => CanvasProject | null; renameProject: (id: string, title: string) => Promise<void>;
    deleteProject: (id: string) => Promise<void>;
    updateProject: (id: string, patch: Partial<CanvasProject>) => void;
    beginOperation: (id: string) => void; endOperation: (id: string) => void;
    retrySave: (id: string) => Promise<void>; ensureSaved: (id: string) => Promise<CanvasProject>;
    syncProject: (id: string) => Promise<void>; reloadProject: (id: string) => Promise<void>; saveCopy: (id: string) => Promise<string>;
    acceptTaskVersion: (taskId: string, projectId: string, nodeId: string) => Promise<void>;
    loadHistory: (id: string) => Promise<void>; undo: (id: string) => Promise<void>; redo: (id: string) => Promise<void>;
};

const drafts = localforage.createInstance({ name: "dream-canvas", storeName: "unsaved-projects" });
const writes = new Map<string, Promise<void>>(), running = new Map<string, Promise<void>>();
const pendingRemoteVersions = new Map<string, number>();
const activeOperations = new Map<string, string>(), operationIds = new WeakMap<CanvasProject, string>();
let tabId = sessionStorage.getItem("dream-canvas-editor") || nanoid();
sessionStorage.setItem("dream-canvas-editor", tabId);
let editorReady: Promise<void> | undefined, loadSequence = 0;
const draftKey = (owner: string, id: string) => `${owner}/${id}/${tabId}`;
const errorText = (error: unknown) => error instanceof Error ? error.message : i18n.t("errors.projectSavePreserved");

function claimEditor() {
    return editorReady ||= new Promise<void>((resolve, reject) => {
        if (!navigator.locks) { reject(new Error(i18n.t("errors.webLocksRequired"))); return; }
        const claim = () => {
            void navigator.locks.request(`dream-canvas-editor:${tabId}`, { ifAvailable: true }, async (lock) => {
                if (!lock) { tabId = nanoid(); sessionStorage.setItem("dream-canvas-editor", tabId); claim(); return; }
                resolve();
                await new Promise<void>(() => {});
            }).catch(reject);
        };
        claim();
    });
}
function emptyProject(title: string): CanvasProject {
    return { id: "", title, version: 0, createdAt: "", updatedAt: "", nodes: [], connections: [], chatSessions: [], activeChatId: null, backgroundMode: "lines", showImageInfo: false, viewport: { x: 0, y: 0, k: 1 } };
}
function saveState(id: string, value: SaveState) {
    useCanvasStore.setState((state) => ({ saves: { ...state.saves, [id]: value } }));
}
function persistDraft(owner: string, project: CanvasProject) {
    const key = draftKey(owner, project.id), base = useCanvasStore.getState().bases[project.id];
    const write = (writes.get(key) || Promise.resolve()).catch(() => undefined).then(async () => { await drafts.setItem(key, { ...project, base }); });
    writes.set(key, write);
    void write.catch((error) => { if (useAuthStore.getState().user?.id === owner) saveState(project.id, { status: "error", message: i18n.t("errors.projectDraftFailed", { error: errorText(error) }) }); });
}

// Reapply edits made after the sent/base snapshot to the acknowledged server document.
function receiveProject(remote: CanvasProject, sent?: CanvasProject) {
    const state = useCanvasStore.getState(), local = state.openProject(remote.id), base = sent || state.bases[remote.id];
    if (!local || state.saves[remote.id]?.status === "conflict") return;
    const acknowledged = state.bases[remote.id];
    if (acknowledged && remote.version <= acknowledged.version) return projectChanges(acknowledged, local).length > 0;
    const changes = base ? projectChanges(base, local) : [];
    const project = changes.length && base ? rebaseProject(base, local, remote) : remote;
    const pending = projectChanges(remote, project).length > 0;
    if (pending) operationIds.set(project, operationIds.get(local) || nanoid());
    useCanvasStore.setState((state) => ({
        projects: state.projects.map((item) => item.id === remote.id ? project : item), bases: { ...state.bases, [remote.id]: remote },
        saves: { ...state.saves, [remote.id]: { status: pending ? "saving" : "saved" } },
    }));
    return pending;
}
function flushProject(id: string): Promise<void> {
    const owner = useAuthStore.getState().user?.id;
    if (!owner) return Promise.resolve();
    const key = draftKey(owner, id), previous = running.get(key);
    if (previous) return previous;
    const assertSession = captureSession();
    const promise = (async () => {
        for (;;) {
            const state = useCanvasStore.getState(), project = state.openProject(id), base = state.bases[id];
            if (useAuthStore.getState().user?.id !== owner || !project || state.saves[id]?.status === "conflict") return;
            try {
                await writes.get(key); assertSession();
                if (useCanvasStore.getState().openProject(id) !== project) continue;
                if (base && !projectChanges(base, project).length) {
                    if (useCanvasStore.getState().openProject(id) !== project) continue;
                    const cleanup = (writes.get(key) || Promise.resolve()).then(async () => { await drafts.removeItem(key); });
                    writes.set(key, cleanup); await cleanup; assertSession();
                    if (useCanvasStore.getState().openProject(id) !== project) continue;
                    saveState(id, { status: "saved" }); return;
                }
                saveState(id, { status: "saving" });
                const saved = await api.saveProject(project, operationIds.get(project)); assertSession();
                receiveProject(saved, project);
                const current = useCanvasStore.getState().openProject(id);
                if (current) persistDraft(owner, current);
                await useCanvasStore.getState().loadHistory(id);
            } catch (error) {
                try { assertSession(); } catch { return; }
                saveState(id, { status: error instanceof ApiError && error.code === "version_conflict" ? "conflict" : "error", message: errorText(error) }); return;
            }
        }
    })().finally(() => {
        running.delete(key);
        const version = pendingRemoteVersions.get(key); pendingRemoteVersions.delete(key);
        if (version && useAuthStore.getState().user?.id === owner && version > (useCanvasStore.getState().bases[id]?.version || 0)) void useCanvasStore.getState().syncProject(id).catch(() => undefined);
    });
    running.set(key, promise);
    return promise;
}
function stage(id: string, patch: Partial<CanvasProject>) {
    const state = useCanvasStore.getState(), current = state.openProject(id), owner = useAuthStore.getState().user?.id;
    if (!current || !owner || Object.entries(patch).every(([key, value]) => dequal(current[key as keyof CanvasProject], value))) return;
    const project = { ...current, ...patch, ...(patch.nodes ? { nodes: assignCanvasNodeIdentities(patch.nodes, current.nodes) } : {}) };
    operationIds.set(project, activeOperations.get(id) || nanoid());
    useCanvasStore.setState({ projects: state.projects.map((item) => item.id === id ? project : item) });
    persistDraft(owner, project);
    if (!["conflict", "error"].includes(state.saves[id]?.status || "")) void flushProject(id);
}
async function travelHistory(id: string, redo: boolean) {
    const store = useCanvasStore.getState(), assertSession = captureSession();
    const project = await store.ensureSaved(id);
    const history = useCanvasStore.getState().histories[id] || { past: [], future: [], head: project.version };
    const stack = redo ? history.future : history.past, target = stack.at(-1);
    if (!target) return;
    const saved = await api.revertProject(id, project.version, target); assertSession();
    receiveProject(saved, project);
    await useCanvasStore.getState().loadHistory(id);
    await flushProject(id);
}

export const useCanvasStore = create<CanvasStore>((set, get) => ({
    hydrated: false, projects: [], bases: {}, saves: {}, histories: {}, error: "",
    reset: () => { loadSequence++; activeOperations.clear(); set({ hydrated: false, projects: [], bases: {}, saves: {}, histories: {}, error: "" }); },
    loadProjects: async () => {
        if (get().hydrated) return get().refreshProjects();
        const owner = useAuthStore.getState().user?.id, sequence = ++loadSequence;
        if (!owner) return;
        try {
            await claimEditor();
            const projects = await api.listProjects(), bases = Object.fromEntries(projects.map((project) => [project.id, project]));
            await Promise.all([...writes.entries()].filter(([key]) => key.startsWith(`${owner}/`)).map(([, write]) => write.catch(() => undefined)));
            const local = new Map<string, { project: CanvasProject; base?: CanvasProject }>();
            await drafts.iterate<CanvasProject & { base?: CanvasProject }, void>((value, key) => {
                if (!key.startsWith(`${owner}/`) || !key.endsWith(`/${tabId}`)) return;
                const { base, ...content } = value;
                const project = canvasProjectSchema.parse(content);
                if (key !== draftKey(owner, project.id)) throw new Error(i18n.t("errors.projectDraftInvalid"));
                local.set(project.id, { project, base });
            });
            const saves: Record<string, SaveState> = {};
            const restored = await Promise.all(projects.map(async (remote) => {
                const draft = local.get(remote.id); if (!draft) return remote; local.delete(remote.id);
                const { base, project } = draft;
                try {
                    if (!base) throw new Error(i18n.t("errors.projectDraftRestored"));
                    canvasProjectSchema.parse(base);
                    saves[remote.id] = { status: "saving" }; return rebaseProject(base, project, remote);
                } catch (error) { saves[remote.id] = { status: "conflict", message: errorText(error) }; bases[remote.id] = base || project; return project; }
            }));
            for (const { project, base } of local.values()) { restored.push(project); bases[project.id] = base || project; saves[project.id] = { status: "conflict", message: i18n.t("errors.projectDeletedDraft") }; }
            if (sequence !== loadSequence || useAuthStore.getState().user?.id !== owner) return;
            set({ projects: restored, bases, saves, hydrated: true, error: "" });
            for (const project of restored) if (saves[project.id]?.status === "saving") void flushProject(project.id);
        } catch (error) { if (sequence === loadSequence && useAuthStore.getState().user?.id === owner) set({ hydrated: false, error: errorText(error) }); }
    },
    refreshProjects: async () => {
        const owner = useAuthStore.getState().user?.id, assertSession = captureSession(); if (!owner || !get().hydrated) return;
        try {
            const projects = await api.listProjects(); assertSession(); if (owner !== useAuthStore.getState().user?.id) return;
            const ids = new Set(projects.map((project) => project.id));
            for (const project of projects) {
                const state = get();
                if (!state.openProject(project.id)) { set({ projects: [...get().projects, project], bases: { ...get().bases, [project.id]: project } }); continue; }
                if (project.version <= (state.bases[project.id]?.version || 0)) continue;
                const key = draftKey(owner, project.id);
                if (running.has(key)) { pendingRemoteVersions.set(key, project.version); continue; }
                if (state.saves[project.id]?.status === "conflict") continue;
                try { const pending = receiveProject(project); if (pending) { persistDraft(owner, get().openProject(project.id)!); void flushProject(project.id); } void get().loadHistory(project.id).catch(() => undefined); }
                catch (error) { saveState(project.id, { status: "conflict", message: errorText(error) }); }
            }
            for (const project of get().projects) if (!ids.has(project.id) && (get().saves[project.id]?.status && get().saves[project.id].status !== "saved" || get().bases[project.id] && projectChanges(get().bases[project.id], project).length)) saveState(project.id, { status: "conflict", message: i18n.t("errors.projectDeletedDraft") });
            set((state) => ({ projects: state.projects.filter((project) => ids.has(project.id) || state.saves[project.id]?.status === "conflict"), error: "" }));
        } catch (error) { try { assertSession(); } catch { return; } if (owner === useAuthStore.getState().user?.id) set({ error: errorText(error) }); }
    },
    createProject: async (title = i18n.t("canvas.project.untitled")) => get().importProject({ title }),
    importProject: async (source) => {
        const assertSession = captureSession();
        const project = await api.createProject({ ...emptyProject(source.title || i18n.t("canvas.project.imported")), ...source, id: "", version: 0 }); assertSession();
        set((state) => ({ projects: [project, ...state.projects], bases: { ...state.bases, [project.id]: project }, saves: { ...state.saves, [project.id]: { status: "saved" } } })); return project.id;
    },
    openProject: (id) => get().projects.find((project) => project.id === id) || null,
    updateProject: stage,
    beginOperation: (id) => { activeOperations.set(id, nanoid()); }, endOperation: (id) => { activeOperations.delete(id); },
    renameProject: async (id, title) => { stage(id, { title: title.trim() }); await get().ensureSaved(id); },
    retrySave: async (id) => { const owner = useAuthStore.getState().user?.id, project = get().openProject(id); if (owner && project) persistDraft(owner, project); saveState(id, { status: "saving" }); await flushProject(id); const state = get().saves[id]; if (state?.status !== "saved") throw new Error(state?.message || i18n.t("errors.projectSaveRequired")); },
    ensureSaved: async (id) => {
        const assertSession = captureSession(), owner = useAuthStore.getState().user?.id;
        if (owner) await running.get(draftKey(owner, id));
        if (["conflict", "error"].includes(get().saves[id]?.status || "")) throw new Error(get().saves[id]?.message || i18n.t("errors.projectSaveRequired"));
        await flushProject(id); assertSession();
        const project = get().openProject(id);
        if (!project || get().saves[id]?.status !== "saved") throw new Error(get().saves[id]?.message || i18n.t("errors.projectBeforeGenerate")); return project;
    },
    syncProject: async (id) => {
        const assertSession = captureSession(), owner = useAuthStore.getState().user?.id; if (!owner) return;
        await running.get(draftKey(owner, id)); assertSession();
        const project = await api.getProject(id); assertSession();
        const key = draftKey(owner, id);
        if (running.has(key)) { pendingRemoteVersions.set(key, project.version); return; }
        let pending: boolean | undefined;
        try { pending = receiveProject(project); }
        catch (error) { saveState(id, { status: "conflict", message: errorText(error) }); throw error; }
        if (pending) { persistDraft(owner, get().openProject(id)!); await flushProject(id); }
        await get().loadHistory(id);
    },
    reloadProject: async (id) => {
        const assertSession = captureSession(), owner = useAuthStore.getState().user?.id; if (!owner) return;
        const key = draftKey(owner, id); await running.get(key); assertSession();
        const before = get().openProject(id), project = await api.getProject(id); assertSession();
        if (get().openProject(id) !== before) throw new Error(i18n.t("errors.projectReadEdited"));
        set((state) => ({ projects: state.projects.map((item) => item.id === id ? project : item), bases: { ...state.bases, [id]: project }, saves: { ...state.saves, [id]: { status: "saved" } } }));
        const cleanup = (writes.get(key) || Promise.resolve()).catch(() => undefined).then(async () => { await drafts.removeItem(key); }); writes.set(key, cleanup); await cleanup;
    },
    saveCopy: async (id) => { const project = get().openProject(id); if (!project) throw new Error(i18n.t("errors.projectMissing")); return get().importProject({ ...project, title: i18n.t("errors.projectCopy", { title: project.title }) }); },
    deleteProject: async (id) => {
        const assertSession = captureSession(), owner = useAuthStore.getState().user?.id; if (!owner) return;
        const project = await get().ensureSaved(id); assertSession();
        await api.deleteProject(id, project.version); assertSession();
        const key = draftKey(owner, id), cleanup = (writes.get(key) || Promise.resolve()).catch(() => undefined).then(async () => { await drafts.removeItem(key); }); writes.set(key, cleanup); await cleanup; assertSession();
        set((state) => ({ projects: state.projects.filter((project) => project.id !== id) }));
    },
    acceptTaskVersion: async (_taskId, projectId, _nodeId) => get().syncProject(projectId),
    loadHistory: async (id) => {
        const assertSession = captureSession(), history = await api.projectHistory(id); assertSession();
        set((state) => {
            if (history.head <= (state.histories[id]?.head || 0)) return state;
            return { histories: { ...state.histories, [id]: history } };
        });
    },
    undo: (id) => travelHistory(id, false), redo: (id) => travelHistory(id, true),
}));
