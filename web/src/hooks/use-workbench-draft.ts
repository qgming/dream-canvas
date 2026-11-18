import { useCallback, useRef, type SetStateAction } from "react";
import { useWorkbenchDraftStore, type WorkbenchDraft, type WorkbenchKind } from "@/stores/use-workbench-draft-store";
import { captureSession } from "@/services/api/client";

export function useWorkbenchDraft(kind: WorkbenchKind) {
    const assertSession = useRef(captureSession()).current;
    const draft = useWorkbenchDraftStore((state) => state.drafts[kind]);
    const hydrated = useWorkbenchDraftStore((state) => state.hydrated);
    const error = useWorkbenchDraftStore((state) => state.error);
    const update = useWorkbenchDraftStore((state) => state.update);
    const clear = useWorkbenchDraftStore((state) => state.clear);
    const load = useWorkbenchDraftStore((state) => state.load);
    const retrySave = useWorkbenchDraftStore((state) => state.retrySave);
    const setField = useCallback(<K extends keyof WorkbenchDraft>(key: K, value: SetStateAction<WorkbenchDraft[K]>) => {
        try { assertSession(); } catch { return; }
        update(kind, (current) => ({ [key]: typeof value === "function" ? (value as (previous: WorkbenchDraft[K]) => WorkbenchDraft[K])(current[key]) : value }));
    }, [kind, update, assertSession]);
    return {
        ...draft, selectedModel: draft.model, hydrated, error, load, retrySave,
        setPrompt: useCallback((value: SetStateAction<string>) => setField("prompt", value), [setField]),
        setSelectedModel: useCallback((value: SetStateAction<string | null>) => setField("model", value), [setField]),
        setParameters: useCallback((value: SetStateAction<WorkbenchDraft["parameters"]>) => setField("parameters", value), [setField]),
        setReferenceModes: useCallback((value: SetStateAction<WorkbenchDraft["referenceModes"]>) => setField("referenceModes", value), [setField]),
        setReferences: useCallback((value: SetStateAction<WorkbenchDraft["references"]>) => setField("references", value), [setField]),
        setRecordId: useCallback((value: string) => setField("recordId", value), [setField]),
        clearDraft: useCallback(() => clear(kind), [kind, clear]),
    };
}
