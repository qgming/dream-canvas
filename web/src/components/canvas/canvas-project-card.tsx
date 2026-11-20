import appI18n from "@/i18n";
import { Download, Ellipsis, Pencil, Trash2 } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useFeedback } from "@/hooks/use-feedback";
import { Button } from "@/components/ui/button";
import { Menu } from "@/components/ui/popover";
import { useTranslation } from "react-i18next";

import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import { useCanvasUiStore } from "@/stores/canvas/use-canvas-ui-store";
import { exportCanvasProjects } from "@/lib/canvas/canvas-export";

export function CanvasProjectCard({ project }: { project: CanvasProject }) {
    const { i18n, t } = useTranslation();
    const { notify } = useFeedback();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const startEditing = useCanvasUiStore((state) => state.startEditingProject);
    const setDeleteIds = useCanvasUiStore((state) => state.setDeleteProjectIds);
    const open = () => {
        navigate(`/canvas/${project.id}${searchParams.toString() ? `?${searchParams.toString()}` : ""}`);
    };

    return (
        <article className="group flex min-h-40 min-w-0 cursor-pointer flex-col justify-between rounded-xl border border-border bg-card p-4 transition-colors hover:bg-accent" onClick={open}>
            <button type="button" className="min-w-0 cursor-pointer text-left outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={(event) => { event.stopPropagation(); open(); }}>
                <h2 className="truncate text-base font-medium">{project.title}</h2>
                <p className="mt-1 text-sm leading-5 text-muted-foreground">{t("canvas.project.stats", { nodes: project.nodes.length, connections: project.connections.length })}</p>
            </button>
            <div className="mt-5 flex items-center justify-between gap-2">
                <p className="min-w-0 truncate text-xs text-muted-foreground">{t("canvas.project.updated", { date: new Date(project.updatedAt).toLocaleString(i18n.resolvedLanguage, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) })}</p>
                <div onClick={(event) => event.stopPropagation()}>
                    <Menu placement="bottomRight" items={[
                        { key: "rename", label: t("canvas.project.rename"), icon: <Pencil />, onClick: () => startEditing(project.id) },
                        { key: "export", label: t("canvas.project.export"), icon: <Download />, onClick: () => void exportCanvasProjects([project], project.title || t("canvas.title")).catch((error: unknown) => notify.error(error instanceof Error ? error.message : appI18n.t("workspace.exportProjectFailed"))) },
                        { key: "delete", label: t("canvas.project.delete"), icon: <Trash2 />, danger: true, onClick: () => setDeleteIds([project.id]) },
                    ]}><Button variant="ghost" size="icon" className="size-7" title={t("ui.moreActions")} aria-label={t("ui.moreActions")}><Ellipsis /></Button></Menu>
                </div>
            </div>
        </article>
    );
}
