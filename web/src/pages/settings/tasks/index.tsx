import { useTranslation } from "react-i18next";
import appI18n from "@/i18n";
import { PageHeader } from "@/components/layout/page-header";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Notice as Alert } from "@/components/ui/display";
import { useFeedback } from "@/hooks/use-feedback";
import { Button } from "@/components/ui/button";
import { Menu } from "@/components/ui/popover";
import { Details } from "@/components/ui/data-table";
import { Dialog, Sheet } from "@/components/ui/dialog";
import { EditorForm, Field, useEditorForm, validateForm } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { z } from "zod";
import { EmptyState as Empty, Spinner } from "@/components/ui/display";
import { Choice } from "@/components/ui/choice";
import { DataTable } from "@/components/ui/data-table";
import { Badge as Tag } from "@/components/ui/display";
import { ChartNoAxesCombined, Check, ChevronDown, CircleX, Ellipsis, ListTodo, RefreshCw, Trash2 } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { Collapsible, Tabs } from "@animate-ui/react/primitives/radix-ui";

import { AssetMedia } from "@/components/canvas/asset-media";
import { assetUrl } from "@/services/api/assets";
import { cancelGeneration, deleteGeneration, generationEnded, generationNeedsResolution, getGeneration, listGenerations, recoverGenerationQuery, resolveGeneration, resumeGeneration, type GenerationTask, type TaskResolution } from "@/services/api/tasks";
import { GenerationProgress } from "@/components/generation-progress";
import { captureSession } from "@/services/api/client";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useConfigStore } from "@/stores/use-config-store";
import { useAuthStore } from "@/stores/use-auth-store";
import { UsagePanel } from "./usage";


export default function TasksPage() {
    useTranslation();
    const { notify, confirm } = useFeedback();

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
    const [searchParams, setSearchParams] = useSearchParams();
    const usageView = searchParams.get("view") === "usage" && !searchParams.has("taskId");
    const query = useQuery({ queryKey: ["generation-tasks"], queryFn: () => listGenerations(), enabled: !usageView });
    const admin = useAuthStore((state) => state.user?.role === "admin");
    const [filter, setFilter] = useState("");
    const [selectedId, setSelectedId] = useState(searchParams.get("taskId") || "");
    const [recovery, setRecovery] = useState<GenerationTask | null>(null);
    const recoveryForm = useEditorForm<{ upstreamId: string }>({ upstreamId: "" });
    const [cancelling, setCancelling] = useState("");
    const cancellingRef = useRef(false);
    const projects = useCanvasStore((state) => state.projects);
    const channels = useConfigStore((state) => state.config.channels);
    const detail = useQuery({ queryKey: ["generation-task", selectedId], queryFn: () => getGeneration(selectedId), enabled: Boolean(selectedId) });
    useEffect(() => { setSelectedId(searchParams.get("taskId") || ""); }, [searchParams]);
    useEffect(() => {
        const refresh = (event: Event) => { if ((event as CustomEvent<string>).detail === "assistant") return; void queryClient.invalidateQueries({ queryKey: ["generation-tasks"] }); void queryClient.invalidateQueries({ queryKey: ["generation-task"] }); };
        window.addEventListener("server-changed", refresh);
        return () => window.removeEventListener("server-changed", refresh);
    }, [queryClient]);
    const closeDetails = () => { setSelectedId(""); if (searchParams.has("taskId")) setSearchParams((current) => { const next = new URLSearchParams(current); next.delete("taskId"); return next; }, { replace: true }); };
    const updateTask = (updated: GenerationTask) => { queryClient.setQueryData(["generation-task", updated.id], updated); queryClient.setQueryData<GenerationTask[]>(["generation-tasks"], (tasks) => tasks?.map((task) => task.id === updated.id ? updated : task)); };
    const canConfirmSuccess = (task: GenerationTask) => task.saveState === "saved" && (task.capability === "text" ? Boolean(task.text.trim()) : Boolean(task.assetIds?.length));
    const resolve = (task: GenerationTask, status: TaskResolution) => {
        const assertSession = captureSession();
        const label = appI18n.t(status === "cancelled" ? "workspace.cancelTask" : status === "failed" ? "workspace.confirmTaskFailed" : "workspace.confirmTaskSucceeded");
        confirm({ title: label, content: <div className="space-y-3"><p>{appI18n.t("workspace.resolveTaskHint")}</p><p className="break-all text-xs">{appI18n.t("workspace.taskId")}：{task.id}</p></div>, confirmText: label, destructive: status !== "succeeded", onConfirm: async () => {
            assertSession();
            const updated = await resolveGeneration(task, status); assertSession(); updateTask(updated);
            await query.refetch(); notify.success(appI18n.t("workspace.taskResolved"));
        } });
    };
    const remove = (task: GenerationTask) => {
        const assertSession = captureSession();
        confirm({ title: appI18n.t("workspace.deleteTaskRecord"), content: appI18n.t("workspace.deleteTaskRecordHint"), confirmText: appI18n.t("workspace.confirmDelete"), destructive: true, onConfirm: async () => {
            assertSession(); await deleteGeneration(task); assertSession();
            queryClient.setQueryData<GenerationTask[]>(["generation-tasks"], (tasks) => tasks?.filter((item) => item.id !== task.id));
            queryClient.setQueryData(["generation-task", task.id], { ...task, removed: true });
            if (selectedId === task.id) closeDetails();
            await query.refetch(); notify.success(appI18n.t("workspace.taskRecordDeleted"));
        } });
    };
    const cancel = async (task: GenerationTask) => {
        if (generationNeedsResolution(task)) { resolve(task, "cancelled"); return; }
        if (cancellingRef.current) return;
        cancellingRef.current = true;
        const assertSession = captureSession();
        setCancelling(task.id);
        try { const updated = await cancelGeneration(task.id); assertSession(); updateTask(updated); await query.refetch(); notify.success(updated.status === "cancelled" ? appI18n.t("workspace.taskCancelled") : appI18n.t("workspace.cancelUpdated")); }
        catch (error) { notify.error(error instanceof Error ? error.message : appI18n.t("workspace.cancelFailed")); }
        finally { cancellingRef.current = false; setCancelling(""); }
    };
    const resume = async (task: GenerationTask) => {
        if (cancellingRef.current) return;
        const assertSession = captureSession(); cancellingRef.current = true; setCancelling(task.id);
        try { const updated = await resumeGeneration(task.id); assertSession(); updateTask(updated); await query.refetch(); }
        catch (error) { notify.error(error instanceof Error ? error.message : appI18n.t("workspace.operationFailed")); }
        finally { cancellingRef.current = false; setCancelling(""); }
    };
    const modelLabel = (task: GenerationTask) => {
        const channel = channels.find((item) => item.id === task.channelId);
        const model = channel?.models.find((item) => item.id === task.modelId);
        return `${channel?.name || task.channelId} / ${model?.label || task.modelId}`;
    };
    const changeView = (view: string) => {
        setSelectedId("");
        setSearchParams((current) => {
            const next = new URLSearchParams(current); next.delete("taskId");
            if (view === "usage") next.set("view", "usage"); else next.delete("view");
            return next;
        });
    };
    const task = detail.data;
    return (
        <section className="space-y-4">
            <PageHeader title={appI18n.t("settings.tasks")} />
            <Tabs.Root value={usageView ? "usage" : "tasks"} onValueChange={changeView} className="min-w-0">
                <div className="thin-scrollbar mb-4 min-w-0 overflow-x-auto overflow-y-hidden pb-2">
                    <Tabs.List aria-label={appI18n.t("settings.tasks")} className="inline-flex w-max items-center gap-1 rounded-xl border border-border bg-card p-1">
                        {[{ key: "tasks", label: "workspace.tasks", icon: ListTodo }, { key: "usage", label: "usage.title", icon: ChartNoAxesCombined }].map(({ key, label, icon: Icon }) => <Tabs.Trigger key={key} value={key} className="inline-flex h-8 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md px-3 text-sm font-medium text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[state=active]:bg-accent data-[state=active]:text-card-foreground data-[state=active]:shadow-sm"><Icon className="size-4 text-foreground" />{appI18n.t(label)}</Tabs.Trigger>)}
                    </Tabs.List>
                </div>
                <Tabs.Content value="tasks" className="outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <div className="space-y-4">
                        <div className="flex flex-wrap items-center justify-between gap-3"><Choice aria-label={appI18n.t("workspace.filterTaskStatus")} className="w-48" value={filter} onChange={setFilter} options={[{ value: "", label: appI18n.t("workspace.allStates") }, ...Object.entries(states).map(([value, item]) => ({ value, label: item.label }))]} /><Button variant="outline" icon={<RefreshCw className="size-4" />} loading={query.isFetching} onClick={() => { void query.refetch(); if (selectedId) void detail.refetch(); }}>{appI18n.t("workspace.refresh")}</Button></div>
                        {query.error ? <Alert type="error" title={query.error.message} action={<Button onClick={() => void query.refetch()}>{appI18n.t("workspace.retry")}</Button>} /> : null}
                        <DataTable<GenerationTask> rowId="id" rows={query.data?.filter((task) => !filter || task.status === filter)} loading={query.isLoading} failed={query.isError} pageSize={20} empty={<Empty description={appI18n.t("workspace.tasksEmpty")} />} columns={[
                            { title: appI18n.t("workspace.type"), render: (_, task) => kinds[task.capability] },
                            { title: appI18n.t("workspace.project"), render: (_, task) => task.projectId ? <Link to={`/canvas/${encodeURIComponent(task.projectId)}`}>{projects.find((item) => item.id === task.projectId)?.title || appI18n.t("workspace.targetProject")}</Link> : appI18n.t("workspace.workbench") },
                            { title: appI18n.t("workspace.channelModel"), render: (_, task) => <span className="break-all text-xs">{modelLabel(task)}</span> },
                            { title: appI18n.t("workspace.status"), render: (_, task) => <div className="space-y-1"><Tag color={states[task.status]?.color}>{task.status === "running" && task.providerStatus === "queued" ? appI18n.t("workspace.providerQueued") : states[task.status]?.label || task.status}</Tag>{task.resolvedAt ? <div className="text-xs text-muted-foreground">{appI18n.t("workspace.manuallyResolved")}</div> : null}{typeof task.progress === "number" && !generationEnded(task) ? <div className="text-xs text-muted-foreground">{appI18n.t("workspace.providerProgress", { percent: task.progress })}</div> : null}</div> },
                            { title: appI18n.t("workspace.submittedAt"), render: (_, task) => new Date(task.createdAt).toLocaleString(appI18n.resolvedLanguage) },
                            { title: appI18n.t("workspace.actions"), render: (_, task) => <div className="flex items-center gap-2"><Button variant="outline" size="sm" onClick={() => setSelectedId(task.id)}>{appI18n.t("workspace.details")}</Button>{generationNeedsResolution(task) || !generationEnded(task) && !task.cancelRequested ? <Button variant="outline" size="sm" disabled={Boolean(cancelling)} loading={cancelling === task.id} onClick={() => void cancel(task)}>{appI18n.t("workspace.cancelTask")}</Button> : null}<Menu placement="bottomRight" disabled={Boolean(cancelling)} items={[
                                ...(task.status === "confirmation_required" ? [{ key: "resume", label: appI18n.t("execution.resumeTask"), icon: <RefreshCw />, onClick: () => void resume(task) }] : []),
                                ...(generationNeedsResolution(task) ? [
                                    { key: "succeeded", label: appI18n.t("workspace.confirmTaskSucceeded"), icon: <Check />, disabled: !canConfirmSuccess(task), onClick: () => resolve(task, "succeeded") },
                                    { key: "failed", label: appI18n.t("workspace.confirmTaskFailed"), icon: <CircleX />, onClick: () => resolve(task, "failed") },
                                ] : []),
                                { key: "delete", label: appI18n.t("workspace.deleteTaskRecord"), icon: <Trash2 />, danger: true, disabled: !generationEnded(task), onClick: () => remove(task) },
                            ]}><Button variant="outline" size="icon" className="size-7" title={appI18n.t("ui.moreActions")} aria-label={appI18n.t("ui.moreActions")}><Ellipsis /></Button></Menu></div> },
                        ]} />
                    </div>
                </Tabs.Content>
                <Tabs.Content value="usage" className="outline-none focus-visible:ring-2 focus-visible:ring-ring"><UsagePanel /></Tabs.Content>
            </Tabs.Root>
            <Sheet title={appI18n.t("workspace.taskDetails")} open={Boolean(selectedId)} onClose={closeDetails} width={640}>
                {detail.isLoading ? <Spinner /> : null}
                {detail.error ? <Alert type="error" title={detail.error.message} action={<Button onClick={() => void detail.refetch()}>{appI18n.t("workspace.reload")}</Button>} /> : null}
                {task ? <div className="space-y-6">
                    <GenerationProgress task={task} />
                    <Details   items={[
                        { key: "id", label: appI18n.t("workspace.taskId"), children: <span className="break-all">{task.id}</span> },
                        { key: "status", label: appI18n.t("workspace.generationStatus"), children: states[task.status]?.label || task.status },
                        { key: "save", label: appI18n.t("workspace.originalSave"), children: saveStates[task.saveState] || appI18n.t("workspace.noSaveResult") },
                        { key: "sync", label: appI18n.t("workspace.cloudSync"), children: syncStates[task.syncState] || appI18n.t("workspace.noSyncRecord") },
                        { key: "upstream", label: appI18n.t("workspace.upstreamId"), children: task.upstreamId || appI18n.t("workspace.notRecorded") },
                        ...(task.queryRecoveredAt ? [{ key: "queryRecovered", label: appI18n.t("workspace.queryRecoveredAt"), children: new Date(task.queryRecoveredAt).toLocaleString(appI18n.resolvedLanguage) }] : []),
                        ...(task.resolvedAt ? [{ key: "resolved", label: appI18n.t("workspace.taskResolvedAt"), children: new Date(task.resolvedAt).toLocaleString(appI18n.resolvedLanguage) }] : []),
                        ...(task.resolutionNote ? [{ key: "resolutionNote", label: appI18n.t("workspace.taskResolutionNote"), children: task.resolutionNote }] : []),
                        { key: "version", label: appI18n.t("workspace.submittedProjectVersion"), children: task.projectId ? task.projectVersion : appI18n.t("workspace.workbenchTask") },
                        { key: "cancel", label: appI18n.t("workspace.cancelRequest"), children: task.cancelRequested ? appI18n.t("workspace.cancelRequested") : appI18n.t("workspace.notRequested") },
                    ]} />
                    {task.error ? <Alert type={task.resolvedAt || task.status === "confirmation_required" ? "warning" : "error"} title={task.error} /> : null}
                    {task.applyError ? <Alert type="warning" title={task.applyError} /> : null}
                    {task.cancelError ? <Alert type="warning" title={task.cancelError} /> : null}
                    {task.responseCleanupError ? <Alert type="warning" title={task.responseCleanupError} /> : null}
                    {task.resolvedAt ? <Alert type="info" title={appI18n.t("workspace.manuallyResolved")} description={appI18n.t("workspace.manuallyResolvedHint")} /> : null}
                    {task.removed ? <Alert title={appI18n.t("workspace.taskRecordDeleted")} /> : <div className="flex flex-wrap gap-2">
                    {task.status === "confirmation_required" ? <Button disabled={Boolean(cancelling)} onClick={() => void resume(task)}>{appI18n.t("execution.resumeTask")}</Button> : null}
                    {admin && task.status === "confirmation_required" && !task.upstreamId ? <Button disabled={Boolean(cancelling)} onClick={() => { recoveryForm.reset({ upstreamId: "" }); setRecovery(task); }}>{appI18n.t("workspace.queryRecovery")}</Button> : null}
                    {generationNeedsResolution(task) || !generationEnded(task) && !task.cancelRequested ? <Button disabled={Boolean(cancelling)} loading={cancelling === task.id} onClick={() => void cancel(task)}>{appI18n.t("workspace.cancelTask")}</Button> : null}
                    {generationNeedsResolution(task) ? <><Button disabled={Boolean(cancelling) || !canConfirmSuccess(task)} title={!canConfirmSuccess(task) ? appI18n.t("workspace.confirmTaskSuccessUnavailable") : undefined} onClick={() => resolve(task, "succeeded")}>{appI18n.t("workspace.confirmTaskSucceeded")}</Button><Button disabled={Boolean(cancelling)} onClick={() => resolve(task, "failed")}>{appI18n.t("workspace.confirmTaskFailed")}</Button></> : null}
                    <Button data-destructive disabled={Boolean(cancelling) || !generationEnded(task)} title={!generationEnded(task) ? appI18n.t("workspace.endTaskBeforeDelete") : undefined} onClick={() => remove(task)}>{appI18n.t("workspace.deleteTaskRecord")}</Button>
                    </div>}
                    {task.status === "confirmation_required" ? <p className="text-sm text-muted-foreground">{appI18n.t("workspace.pendingOutcome")}</p> : null}
                    {task.text ? <pre className="whitespace-pre-wrap break-words text-sm leading-6">{task.text}</pre> : null}
                    {(task.assetIds || []).map((id) => <div key={id} className="space-y-2">{task.capability !== "text" ? <AssetMedia kind={task.capability} src={assetUrl(id)} alt={appI18n.t("workspace.taskOutput")} controls className="max-h-96 max-w-full object-contain" /> : null}<a href={assetUrl(id)} target="_blank" rel="noreferrer" className="text-sm underline">{appI18n.t("workspace.viewOriginal")}</a></div>)}
                    {task.input == null ? <div className="text-sm">{appI18n.t("workspace.submittedContent")}</div> : <Collapsible.Root className="group">
                        <Collapsible.Trigger asChild>
                            <button type="button" className="flex w-full items-center justify-between gap-3 rounded-sm text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                {appI18n.t("workspace.submittedContent")}
                                <ChevronDown className="size-4 shrink-0 transition-transform group-data-[state=open]:rotate-180" />
                            </button>
                        </Collapsible.Trigger>
                        <Collapsible.Content><pre className="mt-3 whitespace-pre-wrap break-words text-xs leading-5">{JSON.stringify(task.input, null, 2)}</pre></Collapsible.Content>
                    </Collapsible.Root>}
                </div> : null}
            </Sheet>
            <Dialog open={Boolean(recovery)} title={appI18n.t("workspace.queryRecovery")} description={appI18n.t("workspace.queryRecoveryHint")} onClose={() => setRecovery(null)} dirty={recoveryForm.formState.isDirty} confirmText={appI18n.t("workspace.queryRecoveryConfirm")} onConfirm={async () => {
                if (!recovery) return;
                const values = await validateForm(recoveryForm), assertSession = captureSession();
                const updated = await recoverGenerationQuery(recovery, values.upstreamId.trim());
                assertSession();
                queryClient.setQueryData(["generation-task", recovery.id], updated);
                recoveryForm.reset(values); setRecovery(null);
                await query.refetch(); notify.success(appI18n.t("workspace.queryRecovered"));
            }}><EditorForm form={recoveryForm}><Field name="upstreamId" label={appI18n.t("workspace.upstreamId")} schema={z.string().trim().min(1, appI18n.t("workspace.required"))}><Input autoComplete="off" /></Field></EditorForm></Dialog>
        </section>
    );
}
