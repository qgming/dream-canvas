import { AlertDialog } from "@/components/ui/alert-dialog";
import { useTranslation } from "react-i18next";

import { useAssetStore } from "@/stores/use-asset-store";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useCanvasUiStore } from "@/stores/canvas/use-canvas-ui-store";

export function CanvasDeleteProjectsDialog() {
    const { t } = useTranslation();
    const ids = useCanvasUiStore((state) => state.deleteProjectIds);
    const setDeleteIds = useCanvasUiStore((state) => state.setDeleteProjectIds);
    const deleteProjects = useCanvasStore((state) => state.deleteProjects);
    const cleanupImages = useAssetStore((state) => state.cleanupImages);
    const confirm = async () => {
        await deleteProjects(ids);
        cleanupImages();
        setDeleteIds([]);
    };

    return (
        <AlertDialog
            title={t("canvas.project.deleteTitle")}
            description={t("canvas.project.deleteDescription", { count: ids.length })}
            open={ids.length > 0}
            onClose={() => setDeleteIds([])}
            onConfirm={confirm}
            destructive
            confirmText={t("common.delete")}
        />
    );
}
