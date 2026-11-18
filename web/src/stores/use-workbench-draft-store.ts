import { create } from "zustand";
import localforage from "localforage";
import { nanoid } from "nanoid";
import { z } from "zod";
import i18n from "@/i18n";
import { assetId, assetUrl } from "@/services/api/assets";
import { useAuthStore } from "@/stores/use-auth-store";
import type { ReferenceImage } from "@/types/image";

export type WorkbenchKind = "image" | "video";
export type WorkbenchDraft = { recordId: string; prompt: string; model: string | null; parameters: Record<string, Record<string, unknown>>; referenceModes: Record<string, string>; references: ReferenceImage[] };
type Drafts = Record<WorkbenchKind, WorkbenchDraft>;
type DraftStore = {
    drafts: Drafts; hydrated: boolean; error: string;
    reset: () => void; load: () => Promise<void>; retrySave: () => void;
    update: (kind: WorkbenchKind, patch: Partial<WorkbenchDraft> | ((draft: WorkbenchDraft) => Partial<WorkbenchDraft>)) => void;
    clear: (kind: WorkbenchKind) => void;
};

const cache = localforage.createInstance({ name: "dream-canvas", storeName: "workbench-drafts" });
const referenceSchema = z.object({ id: z.string(), name: z.string(), type: z.string(), storageKey: z.string() });
const draftSchema = z.object({ recordId: z.string(), prompt: z.string(), model: z.string().nullable(), parameters: z.record(z.record(z.unknown())), referenceModes: z.record(z.string()), references: z.array(referenceSchema) });
const draftsSchema = z.object({ image: draftSchema, video: draftSchema });
const emptyDraft = (): WorkbenchDraft => ({ recordId: nanoid(), prompt: "", model: null, parameters: {}, referenceModes: {}, references: [] });
const emptyDrafts = (): Drafts => ({ image: emptyDraft(), video: emptyDraft() });
let scopeRevision = 0;
let loading: Promise<void> | null = null;
const writes = new Map<string, Promise<void>>();

function persist() {
    const owner = useAuthStore.getState().user?.id, state = useWorkbenchDraftStore.getState(), scope = scopeRevision;
    if (!owner || !state.hydrated) return;
    // Drafts contain editable inputs and stable media IDs, never media bytes or signed URLs.
    const value = Object.fromEntries(Object.entries(state.drafts).map(([kind, draft]) => [kind, { ...draft, references: draft.references.map((reference) => ({ id: reference.id, name: reference.name, type: reference.type, storageKey: reference.storageKey || (assetId(reference.dataUrl) ? `asset:${assetId(reference.dataUrl)}` : "") })) }]));
    const write = (writes.get(owner) || Promise.resolve()).catch(() => undefined).then(async () => { await cache.setItem(owner, value); });
    writes.set(owner, write);
    void write.then(() => {
        if (scope === scopeRevision && writes.get(owner) === write) useWorkbenchDraftStore.setState({ error: "" });
    }, () => {
        if (scope === scopeRevision && writes.get(owner) === write) useWorkbenchDraftStore.setState({ error: i18n.t("workbench.draftSaveFailed") });
    });
}

export const useWorkbenchDraftStore = create<DraftStore>((set, get) => ({
    drafts: emptyDrafts(), hydrated: false, error: "",
    reset: () => { scopeRevision++; loading = null; set({ drafts: emptyDrafts(), hydrated: false, error: "" }); },
    load: () => {
        const owner = useAuthStore.getState().user?.id, scope = scopeRevision;
        if (!owner || get().hydrated) return Promise.resolve();
        if (loading) return loading;
        const operation = (async () => {
            try {
                await writes.get(owner)?.catch(() => undefined);
                const stored = await cache.getItem<unknown>(owner);
                const parsed = stored == null ? null : draftsSchema.parse(stored);
                const drafts = parsed ? Object.fromEntries(Object.entries(parsed).map(([kind, draft]) => [kind, { ...draft, references: draft.references.map((reference) => ({ ...reference, dataUrl: assetId(reference.storageKey) ? assetUrl(assetId(reference.storageKey)!) : "" })) }])) as Drafts : emptyDrafts();
                if (scope === scopeRevision && useAuthStore.getState().user?.id === owner) set({ drafts, hydrated: true, error: "" });
            } catch {
                if (scope === scopeRevision && useAuthStore.getState().user?.id === owner) set({ error: i18n.t("workbench.draftReadFailed") });
            }
        })();
        loading = operation;
        void operation.finally(() => { if (loading === operation) loading = null; });
        return operation;
    },
    update: (kind, patch) => {
        if (!get().hydrated) return;
        set((state) => ({ drafts: { ...state.drafts, [kind]: { ...state.drafts[kind], ...(typeof patch === "function" ? patch(state.drafts[kind]) : patch) } } }));
        persist();
    },
    clear: (kind) => { get().update(kind, emptyDraft()); },
    retrySave: persist,
}));
