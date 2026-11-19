import { useTranslation } from "react-i18next";
import appI18n from "@/i18n";
import { useFeedback } from "@/hooks/use-feedback";
import { Button } from "@/components/ui/button";
import { useParams } from "react-router-dom";

import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { captureSession } from "@/services/api/client";

export function CanvasSaveStatus() {
    useTranslation();
    const { id = "" } = useParams();
    const { notify, confirm } = useFeedback();
    const state = useCanvasStore((store) => store.saves[id]);
    const error = useCanvasStore((store) => store.error);
    if ((!state || state.status === "saved") && !error) return null;
    if (error && (!state || state.status === "saved")) return <div role="alert" className="absolute inset-x-4 bottom-40 z-50 mx-auto flex w-fit items-center gap-2 rounded-xl border border-border bg-popover px-4 py-3 text-sm text-popover-foreground" data-ui-overlay data-canvas-no-zoom data-canvas-shortcuts-ignore><span>{error}</span><Button variant="ghost" size="sm" onClick={() => { void useCanvasStore.getState().refreshProjects(); window.dispatchEvent(new Event("server-changed")); }}>{appI18n.t("workspace.retry")}</Button></div>;
    if (!state) return null;
    if (state.status === "saving") return <span className="pointer-events-none absolute right-6 top-14 z-30 text-xs text-muted-foreground">{appI18n.t("workspace.saving")}</span>;
    const act = async (action: () => Promise<unknown>) => { try { await action(); } catch (error) { notify.error(error instanceof Error ? error.message : appI18n.t("workspace.operationFailed")); } };
    return (
        <div role="alert" className="absolute inset-x-4 bottom-40 z-50 mx-auto flex w-fit max-w-[calc(100%-2rem)] flex-wrap items-center gap-2 rounded-xl border border-border bg-popover px-4 py-3 text-sm text-popover-foreground shadow-sm" data-ui-overlay data-canvas-no-zoom data-canvas-shortcuts-ignore>
            <span>{state.message || appI18n.t("workspace.savePreserved")}</span>
            {state.status !== "conflict" ? <Button variant="ghost" size="sm" onClick={() => void act(() => useCanvasStore.getState().retrySave(id))}>{appI18n.t("workspace.retrySave")}</Button> : null}
            <Button variant="ghost" size="sm" onClick={() => void act(async () => { await useCanvasStore.getState().saveCopy(id); notify.success(appI18n.t("workspace.savedCopy")); })}>{appI18n.t("workspace.saveCopy")}</Button>
            <Button variant="ghost" size="sm" onClick={() => { const assertSession = captureSession(); confirm({ title: appI18n.t("workspace.reloadProjectTitle"), content: appI18n.t("workspace.reloadProjectDescription"), confirmText: appI18n.t("workspace.discardReload"), cancelText: appI18n.t("workspace.preserveEdits"), onConfirm: async () => { assertSession(); await useCanvasStore.getState().reloadProject(id); assertSession(); } }); }}>{appI18n.t("workspace.reload")}</Button>
        </div>
    );
}
