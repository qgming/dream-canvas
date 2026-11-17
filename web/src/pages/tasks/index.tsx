import { useTranslation } from "react-i18next";
import appI18n from "@/i18n";
import { PageHeader } from "@/components/layout/page-header";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Notice as Alert } from "@/components/ui/display";
import { useFeedback } from "@/hooks/use-feedback";
import { Button } from "@/components/ui/button";
import { Details } from "@/components/ui/data-table";
import { Sheet } from "@/components/ui/dialog";
import { EmptyState as Empty, Spinner } from "@/components/ui/display";
import { Choice } from "@/components/ui/choice";
import { DataTable } from "@/components/ui/data-table";
import { Badge as Tag } from "@/components/ui/display";
import { RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";

import { AssetMedia } from "@/components/canvas/asset-media";
import { assetUrl } from "@/services/api/assets";
import { cancelGeneration, getGeneration, listGenerations, type GenerationTask } from "@/services/api/tasks";
import { captureSession } from "@/services/api/client";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useConfigStore } from "@/stores/use-config-store";


export default function TasksPage() {
    useTranslation();
    const { notify } = useFeedback();

    const states: Record<string, { label: string; color?: string }> = {
        queued: { label: appI18n.t("workspace.queued") }, waiting_assets: { label: appI18n.t("workspace.waitingAssets") }, submitting: { label: appI18n.t("workspace.submitting"), color: "processing" },
        running: { label: appI18n.t("workspace.running"), color: "processing" }, saving: { label: appI18n.t("workspace.saving"), color: "processing" },
        succeeded: { label: appI18n.t("workspace.succeeded"), color: "success" }, failed: { label: appI18n.t("workspace.failed"), color: "error" },
        cancelled: { label: appI18n.t("workspace.cancelled") }, interrupted: { label: appI18n.t("workspace.interrupted"), color: "warning" }, confirmation_required: { label: appI18n.t("workspace.confirmationRequired"), color: "warning" },
    };
    const kinds = { text: appI18n.t("workspace.text"), image: appI18n.t("workspace.image"), video: appI18n.t("workspace.video"), audio: appI18n.t("workspace.audio") };
    const saveStates: Record<string, string> = { saving: appI18n.t("workspace.savingFile"), saved: appI18n.t("workspace.saved"), failed: appI18n.t("workspace.saveFileFailed") };
    const syncStates: Record<string, string> = { local: appI18n.t("workspace.local"), pending: appI18n.t("workspace.syncPending"), syncing: appI18n.t("workspace.syncing"), synced: appI18n.t("workspace.synced"), failed: appI18n.t("workspace.syncFailed") };
    const queryClient = useQueryClient();
    const query = useQuery({ queryKey: ["generation-tasks"], queryFn: listGenerations });
    const [filter, setFilter] = useState("");
    const [selectedId, setSelectedId] = useState("");
    const [cancelling, setCancelling] = useState("");
    const cancellingRef = useRef(false);
    const projects = useCanvasStore((state) => state.projects);
    const channels = useConfigStore((state) => state.config.channels);
    const detail = useQuery({ queryKey: ["generation-task", selectedId], queryFn: () => getGeneration(selectedId), enabled: Boolean(selectedId) });
    useEffect(() => {
        const refresh = () => { void queryClient.invalidateQueries({ queryKey: ["generation-tasks"] }); void queryClient.invalidateQueries({ queryKey: ["generation-task"] }); };
        window.addEventListener("server-changed", refresh);
        return () => window.removeEventListener("server-changed", refresh);
    }, [queryClient]);
    const cancel = async (task: GenerationTask) => {
        if (cancellingRef.current) return;
        cancellingRef.current = true;
        const assertSession = captureSession();
        setCancelling(task.id);
        try { const updated = await cancelGeneration(task.id); assertSession(); queryClient.setQueryData(["generation-task", task.id], updated); await query.refetch(); notify.success(updated.status === "cancelled" ? appI18n.t("workspace.taskCancelled") : appI18n.t("workspace.cancelUpdated")); }
        catch (error) { notify.error(error instanceof Error ? error.message : appI18n.t("workspace.cancelFailed")); }
        finally { cancellingRef.current = false; setCancelling(""); }
    };
    const modelLabel = (task: GenerationTask) => {
        const channel = channels.find((item) => item.id === task.channelId);
        const model = channel?.models.find((item) => item.id === task.modelId);
        return `${channel?.name || task.channelId} / ${model?.label || task.modelId}`;
    };
    const task = detail.data;
    return (
        <main className="h-full overflow-auto bg-background px-6 py-8 text-foreground">
            <div className="mx-auto max-w-7xl space-y-6">
                <PageHeader title={appI18n.t("workspace.tasks")} description={appI18n.t("workspace.tasksDescription")} actions={<Button variant="ghost" icon={<RefreshCw className="size-4" />} loading={query.isFetching} onClick={() => { void query.refetch(); if (selectedId) void detail.refetch(); }}>{appI18n.t("workspace.refresh")}</Button>}><Choice aria-label={appI18n.t("workspace.filterTaskStatus")} className="w-48" value={filter} onChange={setFilter} options={[{ value: "", label: appI18n.t("workspace.allStates") }, ...Object.entries(states).map(([value, item]) => ({ value, label: item.label }))]} /></PageHeader>
                {query.error ? <Alert type="error" title={query.error.message} action={<Button onClick={() => void query.refetch()}>{appI18n.t("workspace.retry")}</Button>} /> : null}
                <DataTable<GenerationTask> rowId="id" rows={query.data?.filter((task) => !filter || task.status === filter)} loading={query.isLoading} failed={query.isError} pageSize={20} empty={<Empty description={appI18n.t("workspace.tasksEmpty")} />} columns={[
                    { title: appI18n.t("workspace.type"), render: (_, task) => kinds[task.capability] },
                    { title: appI18n.t("workspace.project"), render: (_, task) => task.projectId ? <Link to={`/canvas/${encodeURIComponent(task.projectId)}`}>{projects.find((item) => item.id === task.projectId)?.title || appI18n.t("workspace.targetProject")}</Link> : appI18n.t("workspace.workbench") },
                    { title: appI18n.t("workspace.channelModel"), render: (_, task) => <span className="break-all text-xs">{modelLabel(task)}</span> },
                    { title: appI18n.t("workspace.status"), render: (_, task) => <Tag color={states[task.status]?.color}>{states[task.status]?.label || task.status}</Tag> },
                    { title: appI18n.t("workspace.original"), render: (_, task) => saveStates[task.saveState] || appI18n.t("workspace.noSaveResult") },
                    { title: appI18n.t("workspace.cloudSync"), render: (_, task) => syncStates[task.syncState] || appI18n.t("workspace.noSyncRecord") },
                    { title: appI18n.t("workspace.submittedAt"), render: (_, task) => new Date(task.createdAt).toLocaleString(appI18n.resolvedLanguage) },
                    { title: appI18n.t("workspace.actions"), render: (_, task) => <div className="flex gap-1"><Button variant="ghost" size="sm" onClick={() => setSelectedId(task.id)}>{appI18n.t("workspace.details")}</Button>{["queued", "waiting_assets"].includes(task.status) ? <Button variant="ghost" size="sm" disabled={Boolean(cancelling)} loading={cancelling === task.id} onClick={() => void cancel(task)}>{appI18n.t("workspace.cancel")}</Button> : null}</div> },
                ]} />
            </div>
            <Sheet title={appI18n.t("workspace.taskDetails")} open={Boolean(selectedId)} onClose={() => setSelectedId("")} width={640}>
                {detail.isLoading ? <Spinner /> : null}
                {detail.error ? <Alert type="error" title={detail.error.message} action={<Button onClick={() => void detail.refetch()}>{appI18n.t("workspace.reload")}</Button>} /> : null}
                {task ? <div className="space-y-6">
                    <Details   items={[
                        { key: "id", label: appI18n.t("workspace.taskId"), children: <span className="break-all">{task.id}</span> },
                        { key: "status", label: appI18n.t("workspace.generationStatus"), children: states[task.status]?.label || task.status },
                        { key: "save", label: appI18n.t("workspace.originalSave"), children: saveStates[task.saveState] || appI18n.t("workspace.noSaveResult") },
                        { key: "sync", label: appI18n.t("workspace.cloudSync"), children: syncStates[task.syncState] || appI18n.t("workspace.noSyncRecord") },
                        { key: "upstream", label: appI18n.t("workspace.upstreamId"), children: task.upstreamId || appI18n.t("workspace.notRecorded") },
                        { key: "version", label: appI18n.t("workspace.submittedProjectVersion"), children: task.projectId ? task.projectVersion : appI18n.t("workspace.workbenchTask") },
                        { key: "cancel", label: appI18n.t("workspace.cancelRequest"), children: task.cancelRequested ? appI18n.t("workspace.cancelRequested") : appI18n.t("workspace.notRequested") },
                    ]} />
                    {task.error ? <Alert type={task.status === "confirmation_required" ? "warning" : "error"} title={task.error} /> : null}
                    {task.status === "confirmation_required" ? <p className="text-sm text-muted-foreground">{appI18n.t("workspace.pendingOutcome")}</p> : null}
                    {task.text ? <pre className="whitespace-pre-wrap break-words text-sm leading-6">{task.text}</pre> : null}
                    {(task.assetIds || []).map((id) => <div key={id} className="space-y-2">{task.capability !== "text" ? <AssetMedia kind={task.capability} src={assetUrl(id)} alt={appI18n.t("workspace.taskOutput")} controls className="max-h-96 max-w-full object-contain" /> : null}<a href={assetUrl(id)} target="_blank" rel="noreferrer" className="text-sm underline">{appI18n.t("workspace.viewOriginal")}</a></div>)}
                    <details><summary className="cursor-pointer text-sm">{appI18n.t("workspace.submittedContent")}</summary><pre className="mt-3 whitespace-pre-wrap break-words text-xs leading-5">{JSON.stringify(task.input, null, 2)}</pre></details>
                </div> : null}
            </Sheet>
        </main>
    );
}
