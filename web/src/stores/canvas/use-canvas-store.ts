import { create } from "zustand";
import localforage from "localforage";
import { nanoid } from "nanoid";

import i18n from "@/i18n";
import { ApiError, captureSession } from "@/services/api/client";
import * as api from "@/services/api/projects";
import { useAuthStore } from "@/stores/use-auth-store";
import { useCanvasUiStore } from "@/stores/canvas/use-canvas-ui-store";
import { canvasProjectSchema } from "@/lib/canvas/project-schema";
import type { CanvasBackgroundMode } from "@/lib/canvas-theme";
import type { CanvasAssistantSession, CanvasConnection, CanvasNodeData, ViewportTransform } from "@/types/canvas";

export type CanvasProject = {
    id: string;
    title: string;
    version: number;
    createdAt: string;
    updatedAt: string;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    chatSessions: CanvasAssistantSession[];
    activeChatId: string | null;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
    viewport: ViewportTransform;
};

type SaveState = { status: "saving" | "saved" | "conflict" | "error"; message?: string };
type CanvasStore = {
    hydrated: boolean;
    projects: CanvasProject[];
    remoteChanges: Record<string, number>;
    saves: Record<string, SaveState>;
    error: string;
    reset: () => void;
    loadProjects: () => Promise<void>;
    refreshProjects: () => Promise<void>;
    createProject: (title?: string) => Promise<string>;
    importProject: (project: Partial<CanvasProject>) => Promise<string>;
    openProject: (id: string) => CanvasProject | null;
    renameProject: (id: string, title: string) => Promise<void>;
    deleteProjects: (ids: string[]) => Promise<void>;
    updateProject: (id: string, patch: Partial<Pick<CanvasProject, "nodes" | "connections" | "chatSessions" | "activeChatId" | "backgroundMode" | "showImageInfo" | "viewport">>) => void;
    retrySave: (id: string) => Promise<void>;
    ensureSaved: (id: string) => Promise<CanvasProject>;
    reloadProject: (id: string) => Promise<void>;
    saveCopy: (id: string) => Promise<string>;
};

const drafts = localforage.createInstance({ name: "dream-canvas", storeName: "unsaved-projects" });
const writes = new Map<string, Promise<void>>();
const running = new Map<string, Promise<void>>();
let tabId = sessionStorage.getItem("dream-canvas-editor") || nanoid();
sessionStorage.setItem("dream-canvas-editor", tabId);
let editorReady: Promise<void> | undefined;
const draftKey = (owner: string, id: string) => `${owner}/${id}/${tabId}`;
let loadSequence = 0;
const errorText = (error: unknown) => error instanceof Error ? error.message : i18n.t("errors.projectSavePreserved");

function claimEditor() {
    return editorReady ||= new Promise<void>((resolve, reject) => {
        if (!navigator.locks) { reject(new Error(i18n.t("errors.webLocksRequired"))); return; }
        const claim = () => {
            void navigator.locks.request(`dream-canvas-editor:${tabId}`, { ifAvailable: true }, async (lock) => {
                if (!lock) { tabId = nanoid(); sessionStorage.setItem("dream-canvas-editor", tabId); claim(); return; }
                sessionStorage.setItem("dream-canvas-editor", tabId);
                resolve();
                // The browser releases this lock with the document; refresh keeps the ID, copied tabs claim a new one.
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
    const key = draftKey(owner, project.id);
    const write = (writes.get(key) || Promise.resolve()).catch(() => undefined).then(async () => { await drafts.setItem(key, project); });
    writes.set(key, write);
    void write.catch((error) => { if (useAuthStore.getState().user?.id === owner) saveState(project.id, { status: "error", message: i18n.t("errors.projectDraftFailed", { error: errorText(error) }) }); });
}

function flushProject(id: string): Promise<void> {
    const owner = useAuthStore.getState().user?.id;
    if (!owner) return Promise.resolve();
    const key = draftKey(owner, id);
    const previous = running.get(key);
    if (previous) return previous;
    const assertSession = captureSession();
    const promise = (async () => {
        for (;;) {
            if (useAuthStore.getState().user?.id !== owner) return;
            const state = useCanvasStore.getState();
            if (state.saves[id]?.status === "conflict") return;
            const project = state.projects.find((item) => item.id === id);
            if (!project) return;
            saveState(id, { status: "saving" });
            try {
                await writes.get(key);
                assertSession();
                const saved = await api.saveProject(project);
                if (useAuthStore.getState().user?.id !== owner) return;
                const latest = useCanvasStore.getState().projects.find((item) => item.id === id);
                if (!latest) return;
                const changed = latest !== project;
                const next = { ...latest, version: saved.version, createdAt: saved.createdAt, updatedAt: saved.updatedAt };
                useCanvasStore.setState((current) => ({ projects: current.projects.map((item) => item.id === id ? next : item), remoteChanges: Object.fromEntries(Object.entries(current.remoteChanges).filter(([key, version]) => key !== id || version > saved.version)) }));
                const pendingWrite = writes.get(key) || Promise.resolve();
                const finishWrite = pendingWrite.then(async () => {
                    if (useAuthStore.getState().user?.id !== owner) return;
                    const current = useCanvasStore.getState().projects.find((item) => item.id === id);
                    if (current && (changed || current !== next)) await drafts.setItem(key, current);
                    else if (current === next) await drafts.removeItem(key);
                });
                writes.set(key, finishWrite);
                await finishWrite;
                assertSession();
                if (!changed) {
                    const afterCleanup = useCanvasStore.getState().projects.find((item) => item.id === id);
                    if (afterCleanup !== next) continue;
                    saveState(id, { status: "saved" });
                    return;
                }
            } catch (error) {
                try { assertSession(); } catch { return; }
                if (useAuthStore.getState().user?.id === owner) saveState(id, { status: error instanceof ApiError && error.code === "version_conflict" ? "conflict" : "error", message: errorText(error) });
                return;
            }
        }
    })().finally(() => running.delete(key));
    running.set(key, promise);
    return promise;
}

function stage(id: string, patch: Partial<CanvasProject>) {
    const state = useCanvasStore.getState();
    const current = state.projects.find((item) => item.id === id);
    const owner = useAuthStore.getState().user?.id;
    if (!current || !owner) return;
    if (Object.entries(patch).every(([key, value]) => current[key as keyof CanvasProject] === value)) return;
    const project = { ...current, ...patch };
    useCanvasStore.setState({ projects: state.projects.map((item) => item.id === id ? project : item) });
    persistDraft(owner, project);
    if (state.saves[id]?.status !== "conflict" && state.saves[id]?.status !== "error") void flushProject(id);
}

export const useCanvasStore = create<CanvasStore>((set, get) => ({
    hydrated: false,
    projects: [],
    remoteChanges: {},
    saves: {},
    error: "",
    reset: () => { loadSequence += 1; set({ hydrated: false, projects: [], remoteChanges: {}, saves: {}, error: "" }); },
    loadProjects: async () => {
        if (get().hydrated && get().projects.length) return get().refreshProjects();
        const owner = useAuthStore.getState().user?.id;
        if (!owner) return;
        const sequence = ++loadSequence;
        try {
            await claimEditor();
            const projects = await api.listProjects();
            await Promise.all([...writes.entries()].filter(([key]) => key.startsWith(`${owner}/`)).map(([, write]) => write.catch(() => undefined)));
            const saves: Record<string, SaveState> = {};
            const local = new Map<string, CanvasProject>();
            await drafts.iterate<unknown, void>((value, key) => {
                if (!key.startsWith(`${owner}/`) || !key.endsWith(`/${tabId}`)) return;
                const result = canvasProjectSchema.safeParse(value);
                if (!result.success || key !== draftKey(owner, result.data.id)) throw new Error(i18n.t("errors.projectDraftInvalid"));
                local.set(result.data.id, result.data);
            });
            const restored = projects.map((project) => {
                const draft = local.get(project.id);
                if (!draft) return project;
                local.delete(project.id);
                saves[project.id] = { status: draft.version === project.version ? "error" : "conflict", message: i18n.t("errors.projectDraftRestored") };
                return draft;
            });
            for (const draft of local.values()) { restored.push(draft); saves[draft.id] = { status: "conflict", message: i18n.t("errors.projectDeletedDraft") }; }
            if (sequence === loadSequence && useAuthStore.getState().user?.id === owner) set({ projects: restored, saves, hydrated: true, error: "" });
        } catch (error) { if (sequence === loadSequence && useAuthStore.getState().user?.id === owner) set({ hydrated: false, error: errorText(error) }); }
    },
    refreshProjects: async () => {
        const owner = useAuthStore.getState().user?.id;
        if (!owner) return;
        const projects = await api.listProjects();
        if (owner !== useAuthStore.getState().user?.id || !get().hydrated) return;
        const current = get();
        const editing = useCanvasUiStore.getState().activeProjectId;
        const incoming = new Map(projects.map((project) => [project.id, project]));
        const remoteChanges = { ...current.remoteChanges };
        const saves = { ...current.saves };
        const next = current.projects.filter((project) => {
            if (incoming.has(project.id)) return true;
            const status = saves[project.id]?.status;
            if (project.id !== editing && (!status || status === "saved")) return false;
            saves[project.id] = { status: "conflict", message: i18n.t("errors.projectDeletedCurrent") };
            if (remoteChanges[project.id] !== -1) persistDraft(owner, project);
            remoteChanges[project.id] = -1;
            return true;
        }).map((project) => {
            const remote = incoming.get(project.id);
            incoming.delete(project.id);
            if (!remote || remote.version <= project.version) return project;
            const status = current.saves[project.id]?.status;
            if (status === "saving") return project;
            if (project.id !== editing && (!status || status === "saved")) { delete remoteChanges[project.id]; return remote; }
            remoteChanges[project.id] = remote.version;
            return project;
        });
        set({ projects: [...incoming.values(), ...next], saves, remoteChanges, error: "" });
    },
    createProject: async (title = i18n.t("canvas.project.untitled")) => {
        const owner = useAuthStore.getState().user?.id;
        const project = await api.createProject(emptyProject(title));
        if (owner !== useAuthStore.getState().user?.id) throw new Error(i18n.t("errors.accountProjectChanged"));
        set((state) => ({ projects: [project, ...state.projects] }));
        return project.id;
    },
    importProject: async (source) => {
        const owner = useAuthStore.getState().user?.id;
        const project = await api.createProject({ ...emptyProject(source.title || i18n.t("canvas.project.imported")), ...source, id: "", version: 0 });
        if (owner !== useAuthStore.getState().user?.id) throw new Error(i18n.t("errors.accountProjectChanged"));
        set((state) => ({ projects: [project, ...state.projects] }));
        return project.id;
    },
    openProject: (id) => get().projects.find((item) => item.id === id) || null,
    renameProject: async (id, title) => { stage(id, { title: title.trim() }); await flushProject(id); const state = get().saves[id]; if (state?.status === "error" || state?.status === "conflict") throw new Error(state.message || i18n.t("errors.projectNameUnsaved")); },
    deleteProjects: async (ids) => {
        const owner = useAuthStore.getState().user?.id;
        const assertSession = captureSession();
        for (const id of ids) {
            assertSession();
            const project = get().openProject(id);
            if (!project || !owner) continue;
            await running.get(draftKey(owner, id));
            assertSession();
            if (owner !== useAuthStore.getState().user?.id) return;
            const current = get().openProject(id)!;
            const approval = await api.requestApproval("delete_project", id, current.version);
            assertSession();
            await api.decideApproval(approval.id, true);
            assertSession();
            const key = draftKey(owner, id);
            const cleanup = (writes.get(key) || Promise.resolve()).catch(() => undefined).then(async () => { await drafts.removeItem(key); });
            writes.set(key, cleanup);
            await cleanup;
            assertSession();
            if (owner !== useAuthStore.getState().user?.id) return;
            set((state) => ({ projects: state.projects.filter((item) => item.id !== id) }));
        }
    },
    updateProject: stage,
    retrySave: async (id) => { if (get().saves[id]?.status === "conflict") throw new Error(i18n.t("errors.projectVersionConflict")); saveState(id, { status: "saving" }); await flushProject(id); },
    ensureSaved: async (id) => {
        const assertSession = captureSession();
        const pending = get().saves[id];
        if (pending?.status === "conflict" || pending?.status === "error") throw new Error(pending.message || i18n.t("errors.projectSaveRequired"));
        if (get().remoteChanges[id]) throw new Error(i18n.t("errors.projectVersionChanged"));
        if (pending?.status !== "saved") await flushProject(id);
        assertSession();
        const state = get();
        const project = state.openProject(id);
        if (!project || state.saves[id]?.status !== "saved") throw new Error(state.saves[id]?.message || i18n.t("errors.projectBeforeGenerate"));
        if (state.remoteChanges[id]) throw new Error(i18n.t("errors.projectVersionChanged"));
        return project;
    },
    reloadProject: async (id) => {
        const owner = useAuthStore.getState().user?.id;
        if (!owner) return;
        const assertSession = captureSession();
        const key = draftKey(owner, id);
        await running.get(key);
        assertSession();
        if (owner !== useAuthStore.getState().user?.id) return;
        const before = get().openProject(id);
        const project = await api.getProject(id);
        const cleanup = (writes.get(key) || Promise.resolve()).catch(() => undefined).then(async () => {
            assertSession();
            if (get().openProject(id) !== before) throw new Error(i18n.t("errors.projectReadEdited"));
            await drafts.removeItem(key);
            assertSession();
            if (get().openProject(id) !== before) throw new Error(i18n.t("errors.projectReadEdited"));
            set((state) => ({ projects: state.projects.map((item) => item.id === id ? project : item), saves: { ...state.saves, [id]: { status: "saved" } }, remoteChanges: Object.fromEntries(Object.entries(state.remoteChanges).filter(([key]) => key !== id)) }));
        });
        writes.set(key, cleanup);
        await cleanup;
    },
    saveCopy: async (id) => {
        const project = get().openProject(id);
        if (!project) throw new Error(i18n.t("errors.projectMissing"));
        return get().importProject({ ...project, title: i18n.t("errors.projectCopy", { title: project.title }) });
    },
}));
