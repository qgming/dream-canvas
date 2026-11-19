import { useCallback } from "react";
import { useTranslation } from "react-i18next";

import { downloadMediaFile, type MediaDownloadSource } from "@/services/media-download";
import { useFeedback } from "./use-feedback";

export function useDownloadMedia() {
    const { notify } = useFeedback();
    const { t } = useTranslation();

    return useCallback(async (source: MediaDownloadSource, name: string) => {
        try { await downloadMediaFile(source, name); }
        catch (error) { notify.error(error instanceof Error ? error.message : t("assets.downloadFailed")); }
    }, [notify, t]);
}
