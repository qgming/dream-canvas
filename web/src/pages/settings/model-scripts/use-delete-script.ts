import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useFeedback } from "@/hooks/use-feedback";
import { deleteModelScript, type ModelScript } from "@/services/api/channels";
import { captureSession } from "@/services/api/client";

export function useDeleteScript() {
    const { t } = useTranslation();
    const { confirm, notify } = useFeedback();
    const client = useQueryClient();
    const [deleting, setDeleting] = useState("");
    const pending = useRef(false);
    const remove = (script: ModelScript, onDeleted?: () => void) => {
        if (script.builtin || pending.current) return;
        const assertSession = captureSession();
        confirm({ title: t("modelScripts.deleteTitle", { name: script.name }), content: t("modelScripts.deleteHint"), confirmText: t("common.delete"), destructive: true, onConfirm: async () => {
            if (pending.current) return;
            pending.current = true; setDeleting(script.id);
            try {
                assertSession();
                await deleteModelScript(script.id, script.version);
                assertSession();
                client.setQueryData<ModelScript[]>(["model-scripts"], (rows) => rows?.filter((row) => row.id !== script.id));
                client.removeQueries({ queryKey: ["model-script", script.id], exact: true });
                client.removeQueries({ queryKey: ["script-evidence", script.id] });
                onDeleted?.();
                void client.invalidateQueries({ queryKey: ["model-scripts"] });
                notify.success(t("modelScripts.deleted"));
            } finally { pending.current = false; setDeleting(""); }
        } });
    };
    return { remove, deleting };
}
