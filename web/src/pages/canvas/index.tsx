import appI18n from "@/i18n";
import { PageHeader } from "@/components/layout/page-header";
import { useEffect, useRef, useState } from "react";
import { SearchInput } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/display";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Notice as Alert } from "@/components/ui/display";
import { useFeedback } from "@/hooks/use-feedback";
import { Button } from "@/components/ui/button";
import { FileUp, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { readZip } from "@/lib/zip";
import { uploadAsset, type ServerAsset } from "@/services/api/assets";
import { replacePackageAssets } from "@/lib/canvas/asset-package";
import { canvasExportSchema } from "@/lib/canvas/project-schema";
import { captureSession } from "@/services/api/client";
import { CanvasDeleteProjectsDialog } from "@/components/canvas/canvas-delete-projects-dialog";
import { CanvasProjectCard } from "@/components/canvas/canvas-project-card";
import { CanvasProjectRenameDialog } from "@/components/canvas/canvas-project-rename-dialog";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useCanvasUiStore } from "@/stores/canvas/use-canvas-ui-store";

export default function CanvasPage() {
    const { notify } = useFeedback();
    const { t } = useTranslation();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const inputRef = useRef<HTMLInputElement>(null);
    const autoOpenRef = useRef(false);
    const creatingRef = useRef(false);
    const [creating, setCreating] = useState(false);
    const [keyword, setKeyword] = useState("");
    const hydrated = useCanvasStore((state) => state.hydrated);
    const projects = useCanvasStore((state) => state.projects);
    const loadError = useCanvasStore((state) => state.error);
    const createProject = useCanvasStore((state) => state.createProject);
    const importProject = useCanvasStore((state) => state.importProject);
    const setDeleteIds = useCanvasUiStore((state) => state.setDeleteProjectIds);
    const filtered = projects.filter((project) => project.title.toLocaleLowerCase().includes(keyword.trim().toLocaleLowerCase()));

    const mode = searchParams.get("mode");
    const agentMode = mode === "new" || mode === "recent" || mode === "choose";
    const agentQuery = agentMode ? `?${searchParams.toString()}` : "";
    const enterProject = (id: string) => {
        navigate(`/canvas/${id}${agentQuery}`);
    };
    const createAndEnter = async () => {
        if (creatingRef.current) return;
        creatingRef.current = true; setCreating(true);
        try { enterProject(await createProject(t("canvas.defaultTitle", { count: projects.length + 1 }))); }
        catch (error) { navigate("/canvas", { replace: true }); notify.error(error instanceof Error ? error.message : appI18n.t("workspace.createFailed")); }
        finally { creatingRef.current = false; setCreating(false); }
    };
    const importCanvas = async (file?: File) => {
        if (!file) return;
        const assertSession = captureSession();
        try {
            const zip = await readZip(file);
            const projectFile = zip.get("projects.json");
            if (!projectFile) throw new Error("missing projects.json");
            const result = canvasExportSchema.safeParse(JSON.parse(await projectFile.text()));
            if (!result.success) throw new Error(appI18n.t("workspace.invalidProjectPackage"));
            const data = result.data;
            const files = new Map<string, ServerAsset>();
            for (const project of data.projects) for (const item of project.files) {
                assertSession();
                if (!item.storageKey.startsWith("asset:")) throw new Error(appI18n.t("workspace.serverPackageOnly"));
                if (files.has(item.storageKey)) continue;
                const blob = zip.get(item.path);
                if (!blob) throw new Error(appI18n.t("workspace.missingOriginals"));
                files.set(item.storageKey, await uploadAsset(blob.type ? blob : blob.slice(0, blob.size, item.mimeType), project.project.title));
            }
            for (const item of data.projects) { assertSession(); await importProject(replacePackageAssets(item.project, files)); }
            window.dispatchEvent(new Event("assets-changed"));
            notify.success(t("canvas.imported", { count: data.projects.length }));
        } catch (error) {
            notify.error(error instanceof Error ? error.message : t("canvas.importFailed"));
        } finally {
            if (inputRef.current) inputRef.current.value = "";
        }
    };

    useEffect(() => {
        if (!hydrated || loadError || autoOpenRef.current || (mode !== "new" && mode !== "recent")) return;
        autoOpenRef.current = true;
        if (mode === "recent" && projects[0]) enterProject(projects[0].id);
        else void createAndEnter();
    }, [createProject, hydrated, loadError, mode, projects, t]);

    if (hydrated && !loadError && (mode === "new" || mode === "recent")) return <main className="flex h-full items-center justify-center bg-background text-sm text-muted-foreground">{t("canvas.opening")}</main>;

    return (
        <main className="h-full overflow-auto bg-background px-4 py-6 text-foreground sm:px-6 lg:py-8">
            <div className="mx-auto flex w-full max-w-7xl flex-col gap-4">
                {loadError ? <Alert type="error" title={loadError} action={<Button onClick={() => void useCanvasStore.getState().loadProjects()}>{appI18n.t("workspace.retryRead")}</Button>} /> : null}
                <PageHeader title={t("canvas.title")} actions={<>
                        <SearchInput value={keyword} onChange={(event) => setKeyword(event.target.value)} aria-label={t("ui.searchProjects")} placeholder={t("ui.searchProjects")} className="w-full sm:w-72" />
                        {projects.length ? (
                            <Button variant="outline" data-destructive icon={<Trash2 />} disabled={!hydrated} onClick={() => setDeleteIds(projects.map((project) => project.id))}>
                                {t("canvas.deleteAll")}
                            </Button>
                        ) : null}
                        <Button variant="outline" disabled={!hydrated} icon={<FileUp className="size-4" />} onClick={() => inputRef.current?.click()}>
                            {t("canvas.import")}
                        </Button>
                        <Button disabled={!hydrated} loading={creating} variant="default" icon={<Plus className="size-4" />} onClick={createAndEnter}>
                            {t("canvas.create")}
                        </Button>
                </>} />

                {!hydrated ? (
                    <section className="flex min-h-[360px] items-center justify-center border-y border-border text-sm text-muted-foreground ">{t("canvas.loading")}</section>
                ) : filtered.length ? (
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                        {filtered.map((project) => (
                            <CanvasProjectCard key={project.id} project={project} />
                        ))}
                    </div>
                ) : loadError ? null : projects.length ? <EmptyState description={t("ui.noMatches")} /> : (
                    <section className="flex min-h-[360px] flex-col items-center justify-center border-y border-border text-center ">
                        <h2 className="text-xl font-medium">{t("canvas.empty")}</h2>
                        <p className="mt-3 text-sm text-muted-foreground">{t("canvas.emptyDescription")}</p>
                        <Button variant="default" className="mt-6" icon={<Plus className="size-4" />} onClick={createAndEnter}>
                            {t("canvas.create")}
                        </Button>
                    </section>
                )}
            </div>

            <input ref={inputRef} type="file" accept="application/zip,.zip" className="hidden" onChange={(event) => void importCanvas(event.target.files?.[0])} />
            <CanvasDeleteProjectsDialog />
            <CanvasProjectRenameDialog />
        </main>
    );
}
