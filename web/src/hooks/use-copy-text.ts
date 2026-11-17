import { useFeedback } from "./use-feedback";
import copy from "copy-to-clipboard";
import { useTranslation } from "react-i18next";

export function useCopyText() {
    const { notify } = useFeedback();
    const { t } = useTranslation();

    return (value: string, successText = t("common.copied")) => {
        if (copy(value)) notify.success(successText);
        else notify.error(t("ui.copyFailed"));
    };
}
