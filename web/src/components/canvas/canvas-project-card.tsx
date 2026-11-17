import appI18n from "@/i18n";
import { Check, Download, Pencil, Trash2, X } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useFeedback } from "@/hooks/use-feedback";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTranslation } from "react-i18next";
import { useRef, useState } from "react";
import { useEditGuard } from "@/hooks/use-edit-guard";
import { useDiscardChanges } from "@/hooks/use-discard-changes";

import { useCanvasStore, type CanvasProject } from "@/stores/canvas/use-canvas-store";
import { useCanvasUiStore } from "@/stores/canvas/use-canvas-ui-store";
import { exportCanvasProjects } from "@/lib/canvas/canvas-export";

export function CanvasProjectCard({ project }: { project: CanvasProject }) {
    const { i18n, t } = useTranslation();
    const { notify } = useFeedback();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const renameProject = useCanvasStore((state) => state.renameProject);
    const selectedIds = useCanvasUiStore((state) => state.selectedProjectIds);
    const editingId = useCanvasUiStore((state) => state.editingProjectId);
    const editingTitle = useCanvasUiStore((state) => state.editingProjectTitle);
    const startEditing = useCanvasUiStore((state) => state.startEditingProject);
    const setEditingTitle = useCanvasUiStore((state) => state.setEditingProjectTitle);
    const stopEditing = useCanvasUiStore((state) => state.stopEditingProject);
    const toggleSelected = useCanvasUiStore((state) => state.toggleSelectedProjectId);
    const setDeleteIds = useCanvasUiStore((state) => state.setDeleteProjectIds);
    const editing = editingId === project.id;
    const [saving, setSaving] = useState(false);
    const submitting = useRef(false);
    const dirty = editing && editingTitle !== project.title;
    useEditGuard(dirty, stopEditing);
    const cancelRename = useDiscardChanges(dirty, stopEditing);
    const selected = selectedIds.includes(project.id);
    const open = () => {
        navigate(`/canvas/${project.id}${searchParams.toString() ? `?${searchParams.toString()}` : ""}`);
    };
    const saveTitle = async () => {
        if (submitting.current || !editingTitle.trim()) return;
        submitting.current = true; setSaving(true);
        try { await renameProject(project.id, editingTitle); stopEditing(); }
        catch (error) { notify.error(error instanceof Error ? error.message : appI18n.t("workspace.renameFailed")); }
        finally { submitting.current = false; setSaving(false); }
    };

    return (
        <article className="group flex min-h-44 cursor-pointer flex-col justify-between rounded-xl border border-border bg-card p-4 transition-colors hover:bg-accent" onClick={() => !editing && open()}>
            <div className="flex items-start gap-3">
                <input
                    type="checkbox"
                    checked={selected}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => toggleSelected(project.id, event.target.checked)}
                    className="mt-1 size-4 accent-primary"
                    aria-label={t("canvas.project.select", { name: project.title })}
                />
                {editing ? (
                    <Input aria-label={t("canvas.project.rename")} disabled={saving} className="min-w-0" value={editingTitle} onClick={(event) => event.stopPropagation()} onChange={(event) => setEditingTitle(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void saveTitle(); if (event.key === "Escape") cancelRename(); }} autoFocus />
                ) : (
                    <button
                        type="button"
                        className="min-w-0 cursor-pointer text-left"
                        onClick={(event) => {
                            event.stopPropagation();
                            open();
                        }}
                    >
                        <h2 className="truncate text-base font-medium">{project.title}</h2>
                        <p className="mt-3 text-sm leading-6 text-muted-foreground ">
                            {t("canvas.project.stats", { nodes: project.nodes.length, connections: project.connections.length })}
                        </p>
                    </button>
                )}
            </div>
            <div className="mt-8 flex items-end justify-between gap-3">
                <p className="text-xs text-muted-foreground">{t("canvas.project.updated", { date: new Date(project.updatedAt).toLocaleString(i18n.resolvedLanguage, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) })}</p>
                <div className="flex items-center gap-1" onClick={(event) => event.stopPropagation()}>
                    {editing ? (
                        <>
                            <Button variant="ghost" size="sm" loading={saving} disabled={!editingTitle.trim()} icon={<Check className="size-4" />} onClick={saveTitle} aria-label={t("canvas.project.saveName")} />
                            <Button variant="ghost" size="sm" disabled={saving} icon={<X className="size-4" />} onClick={cancelRename} aria-label={t("canvas.project.cancelRename")} />
                        </>
                    ) : (
                        <>
                            <Button variant="ghost" size="sm"  icon={<Download className="size-4" />} onClick={() => void exportCanvasProjects([project], project.title || t("canvas.title")).catch((error: unknown) => { notify.error(error instanceof Error ? error.message : appI18n.t("workspace.exportProjectFailed")); })} aria-label={t("canvas.project.export")} />
                            <Button variant="ghost" size="sm" disabled={Boolean(editingId)} icon={<Pencil className="size-4" />} onClick={() => startEditing(project.id, project.title)} aria-label={t("canvas.project.rename")} />
                            <Button variant="ghost" size="sm"  icon={<Trash2 className="size-4" />} onClick={() => setDeleteIds([project.id])} aria-label={t("canvas.project.delete")} />
                        </>
                    )}
                </div>
            </div>
        </article>
    );
}
