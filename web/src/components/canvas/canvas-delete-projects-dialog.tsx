import { Dialog } from "@/components/ui/dialog";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { useAssetStore } from "@/stores/use-asset-store";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useCanvasUiStore } from "@/stores/canvas/use-canvas-ui-store";

export function CanvasDeleteProjectsDialog() {
    const { t } = useTranslation();
    const [busy, setBusy] = useState(false);
    const ids = useCanvasUiStore((state) => state.deleteProjectIds);
    const setDeleteIds = useCanvasUiStore((state) => state.setDeleteProjectIds);
    const removeSelectedIds = useCanvasUiStore((state) => state.removeSelectedProjectIds);
    const deleteProjects = useCanvasStore((state) => state.deleteProjects);
    const cleanupImages = useAssetStore((state) => state.cleanupImages);
    const confirm = async () => {
        setBusy(true);
        try {
            await deleteProjects(ids);
            cleanupImages();
            removeSelectedIds(ids);
            setDeleteIds([]);
        } finally { setBusy(false); }
    };

    return (
        <Dialog
            title={t("canvas.project.deleteTitle")}
            open={ids.length > 0}
            busy={busy}
            onClose={() => setDeleteIds([])}
            onConfirm={confirm}
            destructive
            confirmText={t("common.delete")}
        >
            <p className="text-sm text-muted-foreground">{t("canvas.project.deleteDescription", { count: ids.length })}</p>
        </Dialog>
    );
}
