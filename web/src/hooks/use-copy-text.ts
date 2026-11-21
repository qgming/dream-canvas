import { useFeedback } from "./use-feedback";
import copy from "copy-to-clipboard";
import { useTranslation } from "react-i18next";

export function useCopyText() {
    const { notify } = useFeedback();
    const { t } = useTranslation();

    return async (value: string, successText = t("common.copied")) => {
        let copied = false;
        try { copied = await copy(value); } catch { /* Clipboard access can be rejected by the browser. */ }
        if (copied) notify.success(successText);
        else notify.error(t("ui.copyFailed"));
    };
}
