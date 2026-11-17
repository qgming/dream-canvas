import { useFeedback } from "./use-feedback";
import { useTranslation } from "react-i18next";

export function useDiscardChanges<Args extends unknown[]>(dirty: boolean, close: (...args: Args) => void | Promise<unknown>) {
    const { confirm, notify } = useFeedback();
    const { t } = useTranslation();
    return (...args: Args) => { if (dirty) confirm({ title: t("ui.discardTitle"), content: t("ui.discardDescription"), confirmText: t("ui.discard"), cancelText: t("ui.keepEditing"), destructive: true, onConfirm: () => close(...args) }); else void Promise.resolve().then(() => close(...args)).catch((error: unknown) => notify.error(error instanceof Error ? error.message : t("ui.operationFailed"))); };
}
