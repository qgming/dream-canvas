import { useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Alert, App, Button } from "antd";
import { Download, FileUp, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";

import { readZip } from "@/lib/zip";
import { uploadAsset, type ServerAsset } from "@/services/api/assets";
import { replacePackageAssets } from "@/lib/canvas/asset-package";
import { canvasExportSchema } from "@/lib/canvas/project-schema";
import { captureSession } from "@/services/api/client";
import { CanvasDeleteProjectsDialog } from "@/components/canvas/canvas-delete-projects-dialog";
import { CanvasProjectCard } from "@/components/canvas/canvas-project-card";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useCanvasUiStore } from "@/stores/canvas/use-canvas-ui-store";
import { exportCanvasProjects } from "@/lib/canvas/canvas-export";

export default function CanvasPage() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const inputRef = useRef<HTMLInputElement>(null);
    const autoOpenRef = useRef(false);
    const hydrated = useCanvasStore((state) => state.hydrated);
    const projects = useCanvasStore((state) => state.projects);
    const loadError = useCanvasStore((state) => state.error);
    const createProject = useCanvasStore((state) => state.createProject);
    const importProject = useCanvasStore((state) => state.importProject);
    const selectedIds = useCanvasUiStore((state) => state.selectedProjectIds);
    const setDeleteIds = useCanvasUiStore((state) => state.setDeleteProjectIds);

    const mode = searchParams.get("mode");
    const agentMode = mode === "new" || mode === "recent" || mode === "choose";
    const agentQuery = agentMode ? `?${searchParams.toString()}` : "";
    const enterProject = (id: string) => {
        navigate(`/canvas/${id}${agentQuery}`);
    };
    const createAndEnter = async () => {
        try { enterProject(await createProject(t("canvas.defaultTitle", { count: projects.length + 1 }))); }
        catch (error) { navigate("/canvas", { replace: true }); message.error(error instanceof Error ? error.message : "创建失败"); }
    };
    const importCanvas = async (file?: File) => {
        if (!file) return;
        const assertSession = captureSession();
        try {
            const zip = await readZip(file);
            const projectFile = zip.get("projects.json");
            if (!projectFile) throw new Error("missing projects.json");
            const result = canvasExportSchema.safeParse(JSON.parse(await projectFile.text()));
            if (!result.success) throw new Error("项目包版本、画布内容或媒体清单不正确，未上传或导入任何内容");
            const data = result.data;
            const files = new Map<string, ServerAsset>();
            for (const project of data.projects) for (const item of project.files) {
                assertSession();
                if (!item.storageKey.startsWith("asset:")) throw new Error("仅支持当前服务端格式的项目包，不迁移旧本地数据");
                if (files.has(item.storageKey)) continue;
                const blob = zip.get(item.path);
                if (!blob) throw new Error("项目包缺少媒体原件");
                files.set(item.storageKey, await uploadAsset(blob.type ? blob : blob.slice(0, blob.size, item.mimeType), project.project.title));
            }
            for (const item of data.projects) { assertSession(); await importProject(replacePackageAssets(item.project, files)); }
            window.dispatchEvent(new Event("assets-changed"));
            message.success(t("canvas.imported", { count: data.projects.length }));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("canvas.importFailed"));
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

    if (hydrated && !loadError && (mode === "new" || mode === "recent")) return <main className="flex h-full items-center justify-center bg-background text-sm text-stone-500">{t("canvas.opening")}</main>;

    return (
        <main className="h-full overflow-auto bg-background text-stone-950 dark:text-stone-100">
            <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-10">
                {loadError ? <Alert type="error" title={loadError} action={<Button onClick={() => void useCanvasStore.getState().loadProjects()}>重试读取</Button>} /> : null}
                <header className="flex flex-wrap items-end justify-between gap-4 border-b border-stone-200 pb-6 dark:border-stone-800">
                    <div>
                        <p className="text-xs text-stone-500">{t("canvas.library")}</p>
                        <h1 className="mt-3 text-3xl font-semibold">{t("canvas.title")}</h1>
                    </div>
                    <div className="flex items-center gap-2">
                        {selectedIds.length ? (
                            <>
                                <Button disabled={!hydrated} icon={<Download className="size-4" />} onClick={() => void exportCanvasProjects(projects.filter((project) => selectedIds.includes(project.id)), `${t("canvas.title")}-${selectedIds.length}`).catch((error: unknown) => { message.error(error instanceof Error ? error.message : "项目导出失败"); })}>
                                    {t("canvas.exportSelected")}
                                </Button>
                                <Button disabled={!hydrated} onClick={() => setDeleteIds(selectedIds)}>
                                    {t("canvas.deleteSelected")}
                                </Button>
                            </>
                        ) : null}
                        {projects.length ? (
                            <Button disabled={!hydrated} onClick={() => setDeleteIds(projects.map((project) => project.id))}>
                                {t("canvas.deleteAll")}
                            </Button>
                        ) : null}
                        <Button disabled={!hydrated} icon={<FileUp className="size-4" />} onClick={() => inputRef.current?.click()}>
                            {t("canvas.import")}
                        </Button>
                        <Button disabled={!hydrated} type="primary" icon={<Plus className="size-4" />} onClick={createAndEnter}>
                            {t("canvas.create")}
                        </Button>
                    </div>
                </header>

                {!hydrated ? (
                    <section className="flex min-h-[360px] items-center justify-center border-y border-stone-200 text-sm text-stone-500 dark:border-stone-800">{t("canvas.loading")}</section>
                ) : projects.length ? (
                    <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                        {projects.map((project) => (
                            <CanvasProjectCard key={project.id} project={project} />
                        ))}
                    </div>
                ) : (
                    <section className="flex min-h-[360px] flex-col items-center justify-center border-y border-stone-200 text-center dark:border-stone-800">
                        <h2 className="text-xl font-medium">{t("canvas.empty")}</h2>
                        <p className="mt-3 text-sm text-stone-500">{t("canvas.emptyDescription")}</p>
                        <Button type="primary" className="mt-6" icon={<Plus className="size-4" />} onClick={createAndEnter}>
                            {t("canvas.create")}
                        </Button>
                    </section>
                )}
            </div>

            <input ref={inputRef} type="file" accept="application/zip,.zip" className="hidden" onChange={(event) => void importCanvas(event.target.files?.[0])} />
            <CanvasDeleteProjectsDialog />
        </main>
    );
}
