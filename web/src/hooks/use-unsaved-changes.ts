import { useEffect } from "react";
import { useBlocker } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useFeedback } from "./use-feedback";

export function useUnsavedChanges(dirty: boolean, onDiscard?: () => void) {
    const { confirm } = useFeedback();
    const { t } = useTranslation();
    const blocker = useBlocker(dirty);
    useEffect(() => {
        if (blocker.state !== "blocked") return;
        const handle = confirm({ title: t("ui.discardTitle"), content: t("ui.discardDescription"), confirmText: t("ui.discard"), cancelText: t("ui.keepEditing"), destructive: true, onConfirm: () => { onDiscard?.(); blocker.proceed(); }, onCancel: () => blocker.reset() });
        return handle.destroy;
    }, [blocker.state]);
    useEffect(() => {
        if (!dirty) return;
        const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
        window.addEventListener("beforeunload", beforeUnload);
        return () => window.removeEventListener("beforeunload", beforeUnload);
    }, [dirty]);
}
