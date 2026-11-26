import { useId, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Download, Ellipsis, FileUp, Folder, FolderOpen, Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { z } from "zod";
import { PageHeader } from "@/components/layout/page-header";
import { AlertDialog } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState, Notice, Spinner } from "@/components/ui/display";
import { EditorForm, Field, useEditorForm } from "@/components/ui/form";
import { Input, SearchInput } from "@/components/ui/input";
import { Menu, type MenuItem } from "@/components/ui/popover";
import { useFeedback } from "@/hooks/use-feedback";
import { exportAssets, importAssetPackage } from "@/lib/asset-transfer";
import { createAssetProject, DEFAULT_ASSET_PROJECT_ID, deleteAssetProject, renameAssetProject, type AssetProject } from "@/services/api/assets";
import { ApiError, captureSession } from "@/services/api/client";
import { useAssetStore } from "@/stores/use-asset-store";
import { assetProjectsKey, useAssetProjects } from "./use-asset-projects";

export default function AssetProjectsPage() {
    const { t } = useTranslation();
    const { notify } = useFeedback();
    const queryClient = useQueryClient();
    const projects = useAssetProjects();
    const assets = useAssetStore((state) => state.assets);
    const hydrated = useAssetStore((state) => state.hydrated);
    const assetError = useAssetStore((state) => state.error);
    const input = useRef<HTMLInputElement>(null);
    const transferring = useRef(false);
    const [keyword, setKeyword] = useState("");
    const [editor, setEditor] = useState<{ project?: AssetProject } | null>(null);
    const [deleting, setDeleting] = useState<AssetProject | null>(null);
    const [transfer, setTransfer] = useState<"export" | "import" | null>(null);
    const [importError, setImportError] = useState("");
    const search = keyword.trim().toLocaleLowerCase();
    const matchesDefault = t("assetProjects.defaultTitle").toLocaleLowerCase().includes(search);
    const visibleProjects = projects.data?.filter((project) => !project.isDefault && project.id !== DEFAULT_ASSET_PROJECT_ID && project.title.toLocaleLowerCase().includes(search)) ?? [];

    const assetCounts = useMemo(() => {
        const counts = new Map<string, number>();
        for (const asset of assets) counts.set(asset.assetProjectId, (counts.get(asset.assetProjectId) || 0) + 1);
        return counts;
    }, [assets]);
    const countFor = (id: string) => hydrated && !assetError ? assetCounts.get(id) || 0 : undefined;

    const refreshProjects = () => queryClient.invalidateQueries({ queryKey: assetProjectsKey });
    const editProjects = async (edit: () => Promise<unknown>) => {
        try { await edit(); }
        finally { void refreshProjects(); }
    };
    const transferProject = async (operation: () => Promise<void>, action: "export" | "import") => {
        if (transferring.current) return;
        transferring.current = true;
        setTransfer(action);
        if (action === "import") setImportError("");
        try { await operation(); }
        catch (error) {
            if (error instanceof ApiError && error.code === "session_changed") return;
            const detail = error instanceof Error ? error.message : t("ui.operationFailed");
            const message = action === "import" ? `${t("backup.importFailed")} ${detail}` : detail;
            if (action === "import") setImportError(message);
            notify.error(message);
        } finally {
            if (action === "import") {
                void refreshProjects();
                window.dispatchEvent(new Event("assets-changed"));
            }
            transferring.current = false;
            setTransfer(null);
        }
    };
    const importProject = (file: File) => transferProject(async () => {
        const assertSession = captureSession();
        const count = await importAssetPackage(file, async (projectTitle) => {
            const title = projectTitle?.trim() || file.name.replace(/\.zip$/i, "").trim() || t("assetProjects.importedTitle");
            const project = await createAssetProject(title).catch((error: unknown) => {
                if (!(error instanceof ApiError) || error.code !== "reserved_asset_project_title") throw error;
                assertSession();
                return createAssetProject(t("assetProjects.importedTitle"));
            });
            assertSession();
            setKeyword("");
            return project.id;
        });
        assertSession();
        notify.success(t("assets.imported", { count }));
    }, "import");
    const exportProject = (project: AssetProject) => transferProject(async () => {
        const assertSession = captureSession();
        await useAssetStore.getState().loadAssets();
        assertSession();
        const current = useAssetStore.getState();
        if (current.error) throw new Error(current.error);
        const filename = project.title.replace(/[\\/:*?"<>|]/g, "_");
        await exportAssets(current.assets.filter((asset) => asset.assetProjectId === project.id), `${filename}.zip`, project.title);
    }, "export");

    return (
        <main className="h-full overflow-auto bg-background px-4 py-6 text-foreground sm:px-6 lg:py-8">
            <div className="mx-auto flex w-full max-w-7xl flex-col gap-4">
                <PageHeader title={t("assets.title")} actions={<>
                    <SearchInput className="w-full sm:w-72" aria-label={t("assetProjects.search")} placeholder={t("assetProjects.search")} value={keyword} onChange={(event) => setKeyword(event.target.value)} />
                    <Button icon={<FileUp />} loading={transfer === "import"} disabled={Boolean(transfer)} onClick={() => input.current?.click()}>{t("assetProjects.import")}</Button>
                    <Button variant="default" icon={<Plus />} disabled={Boolean(transfer)} onClick={() => setEditor({})}>{t("assetProjects.create")}</Button>
                </>} />
                {projects.error ? <Notice type="error" title={projects.error.message} action={<Button onClick={() => void projects.refetch()}>{t("common.retry")}</Button>} /> : null}
                {assetError ? <Notice type="error" title={assetError} action={<Button onClick={() => void useAssetStore.getState().loadAssets()}>{t("common.retry")}</Button>} /> : null}
                {importError ? <Notice type="error" title={importError} onClose={() => setImportError("")} /> : null}
                {transfer ? <p role="status" className="text-xs text-muted-foreground">{t(transfer === "import" ? "backup.importing" : "backup.exporting")}</p> : null}
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {matchesDefault ? <AssetProjectCard count={countFor(DEFAULT_ASSET_PROJECT_ID)} /> : null}
                    {visibleProjects.map((project) => <AssetProjectCard key={project.id} project={project} count={countFor(project.id)} actions={[
                        { key: "rename", label: t("assetProjects.rename"), icon: <Pencil />, disabled: Boolean(transfer), onClick: () => setEditor({ project }) },
                        { key: "export", label: t("assets.export"), icon: <Download />, disabled: Boolean(transfer), onClick: () => void exportProject(project) },
                        { key: "delete", label: t("common.delete"), icon: <Trash2 />, danger: true, disabled: Boolean(transfer), onClick: () => setDeleting(project) },
                    ]} />)}
                </div>
                {projects.isPending ? <div className="flex justify-center py-6"><Spinner /></div> : !matchesDefault && !projects.error && !visibleProjects.length ? <EmptyState description={t("ui.noMatches")} /> : null}
            </div>

            <input ref={input} type="file" accept="application/zip,.zip" hidden onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (file) void importProject(file);
            }} />
            {editor ? <AssetProjectNameDialog project={editor.project} onClose={() => setEditor(null)} onSave={async (title) => {
                const project = editor.project;
                await editProjects(() => project ? renameAssetProject(project.id, title, project.version) : createAssetProject(title));
                setKeyword("");
            }} /> : null}
            <AlertDialog open={Boolean(deleting)} title={t("assetProjects.deleteTitle")} description={t("assetProjects.deleteDescription", { title: deleting?.title })} destructive confirmText={t("common.delete")} onClose={() => setDeleting(null)} onConfirm={async () => {
                if (!deleting) return;
                await editProjects(() => deleteAssetProject(deleting.id, deleting.version));
                setDeleting(null);
                window.dispatchEvent(new Event("assets-changed"));
            }} />
        </main>
    );
}

function AssetProjectCard({ project, count, actions }: { project?: AssetProject; count?: number; actions?: MenuItem[] }) {
    const { i18n, t } = useTranslation();
    const title = project?.title ?? t("assetProjects.defaultTitle");
    const Icon = project ? Folder : FolderOpen;
    const assetCount = count === undefined ? "" : t("assetProjects.assetCount", { count });
    const updatedAt = project ? new Date(project.updatedAt).toLocaleString(i18n.resolvedLanguage, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
    return (
        <article className="relative flex min-h-40 min-w-0 flex-col justify-between rounded-xl border border-border bg-card p-4 text-card-foreground transition-colors hover:bg-accent motion-reduce:transition-none">
            <Link to={`/assets/${encodeURIComponent(project?.id ?? DEFAULT_ASSET_PROJECT_ID)}`} className="min-w-0 text-left outline-none before:absolute before:inset-0 before:rounded-xl focus-visible:before:ring-2 focus-visible:before:ring-inset focus-visible:before:ring-ring">
                <div className="flex min-w-0 items-center gap-2">
                    <Icon aria-hidden className="size-4 shrink-0" />
                    <h2 className="truncate text-base font-medium">{title}</h2>
                </div>
                <p className="mt-1 text-sm leading-5 text-muted-foreground">{project ? assetCount : t("assetProjects.defaultDescription")}</p>
            </Link>
            <div className="mt-5 flex items-center justify-between gap-2">
                <p className="min-w-0 truncate text-xs text-muted-foreground">{project ? <time dateTime={project.updatedAt}>{t("assetProjects.updated", { date: updatedAt })}</time> : assetCount}</p>
                {actions ? <div className="relative z-10"><Menu items={actions} placement="bottomRight"><Button variant="ghost" size="icon" className="size-7" title={t("ui.moreActions")} aria-label={t("ui.moreActions")}><Ellipsis /></Button></Menu></div> : null}
            </div>
        </article>
    );
}

function AssetProjectNameDialog({ project, onClose, onSave }: { project?: AssetProject; onClose: () => void; onSave: (title: string) => Promise<void> }) {
    const { t } = useTranslation();
    const formId = useId();
    const form = useEditorForm<{ title: string }>({ title: project?.title ?? "" });
    const busy = form.formState.isSubmitting;
    return <Dialog open title={t(project ? "assetProjects.rename" : "assetProjects.create")} width={448} onClose={onClose} busy={busy} footer={<Button variant="default" type="submit" form={formId} loading={busy}>{t(project ? "common.save" : "assetProjects.create")}</Button>}>
        <EditorForm id={formId} form={form} onSubmit={async ({ title }: { title: string }) => {
            await onSave(title.trim());
            form.reset({ title: title.trim() });
            onClose();
        }}>
            <Field name="title" label={t("workspace.name")} schema={z.string().trim().min(1, t("ui.nameRequired"))}><Input autoFocus /></Field>
        </EditorForm>
    </Dialog>;
}
