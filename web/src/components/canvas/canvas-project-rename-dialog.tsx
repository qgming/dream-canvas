import { useEffect, useId } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EditorForm, Field, useEditorForm } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useCanvasUiStore } from "@/stores/canvas/use-canvas-ui-store";

export function CanvasProjectRenameDialog() {
    const { t } = useTranslation();
    const formId = useId();
    const form = useEditorForm<{ title: string }>();
    const projectId = useCanvasUiStore((state) => state.editingProjectId);
    const stopEditing = useCanvasUiStore((state) => state.stopEditingProject);
    const project = useCanvasStore((state) => state.projects.find((entry) => entry.id === projectId));
    const renameProject = useCanvasStore((state) => state.renameProject);
    useEffect(() => { if (projectId) form.reset({ title: useCanvasStore.getState().openProject(projectId)?.title || "" }); }, [form, projectId]);
    useEffect(() => stopEditing, [stopEditing]);
    return <Dialog open={Boolean(project)} title={t("canvas.project.rename")} onClose={stopEditing} width={448} busy={form.formState.isSubmitting} footer={<Button variant="default" type="submit" form={formId} loading={form.formState.isSubmitting}>{t("canvas.project.saveName")}</Button>}>
        <EditorForm id={formId} form={form} onSubmit={async (values) => {
            if (!project) return;
            await renameProject(project.id, values.title);
            form.reset({ title: values.title.trim() });
            stopEditing();
        }}>
            <Field name="title" label={t("workspace.name")} schema={z.string().trim().min(1, t("ui.nameRequired"))}><Input autoFocus /></Field>
        </EditorForm>
    </Dialog>;
}
