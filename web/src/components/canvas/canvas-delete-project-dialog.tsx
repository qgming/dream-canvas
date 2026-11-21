import { AlertDialog } from "@/components/ui/alert-dialog";
import { useTranslation } from "react-i18next";

import { useAssetStore } from "@/stores/use-asset-store";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useCanvasUiStore } from "@/stores/canvas/use-canvas-ui-store";

export function CanvasDeleteProjectDialog() {
    const { t } = useTranslation();
    const id = useCanvasUiStore((state) => state.deleteProjectId);
    const setDeleteId = useCanvasUiStore((state) => state.setDeleteProjectId);
    const deleteProject = useCanvasStore((state) => state.deleteProject);
    const cleanupImages = useAssetStore((state) => state.cleanupImages);
    const confirm = async () => {
        if (!id) return;
        await deleteProject(id);
        cleanupImages();
        setDeleteId(null);
    };

    return (
        <AlertDialog
            title={t("canvas.project.deleteTitle")}
            description={t("canvas.project.deleteDescription")}
            open={Boolean(id)}
            onClose={() => setDeleteId(null)}
            onConfirm={confirm}
            destructive
            confirmText={t("common.delete")}
        />
    );
}
