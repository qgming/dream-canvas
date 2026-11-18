import appI18n from "@/i18n";
import { PageHeader } from "@/components/layout/page-header";
import { Notice as Alert } from "@/components/ui/display";
import { useFeedback } from "@/hooks/use-feedback";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/display";
import { EditorForm, Field } from "@/components/ui/form";
import { DataTable } from "@/components/ui/data-table";
import { Choice } from "@/components/ui/choice";
import { Switch } from "@/components/ui/controls";
import { Badge as Tag } from "@/components/ui/display";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useState } from "react";
import { useEditGuard } from "@/hooks/use-edit-guard";
import { useTranslation } from "react-i18next";

import { PromptSourceEditorDrawer } from "./components/prompt-source-editor-drawer";
import { PromptSourceContentModal } from "./components/prompt-source-content-modal";
import { fetchPromptSourceStatuses, refreshAllSources, refreshSource } from "@/services/api/prompts";
import { PROMPT_SOURCE_INTERVALS, usePromptSourceStore } from "@/stores/use-prompt-source-store";
import type { PromptSource } from "@/services/api/prompt-source-presets";
import { captureSession } from "@/services/api/client";

const STATUS_QUERY_KEY = ["prompt-source-statuses"];

export default function PromptSourcesPage() {
    const { notify, confirm } = useFeedback();
    const { i18n, t } = useTranslation();
    const queryClient = useQueryClient();
    const sources = usePromptSourceStore((state) => state.sources);
    const schedule = usePromptSourceStore((state) => state.schedule);
    const addSource = usePromptSourceStore((state) => state.addSource);
    const saveSource = usePromptSourceStore((state) => state.saveSource);
    const removeSource = usePromptSourceStore((state) => state.removeSource);
    const toggleSource = usePromptSourceStore((state) => state.toggleSource);
    const updateSchedule = usePromptSourceStore((state) => state.updateSchedule);
    const dirty = usePromptSourceStore((state) => state.dirty);
    const saving = usePromptSourceStore((state) => state.saving);
    const error = usePromptSourceStore((state) => state.error);
    const hydrated = usePromptSourceStore((state) => state.hydrated);
    const discard = useCallback(() => { void usePromptSourceStore.getState().load(true); }, []);
    useEditGuard(dirty, discard);
    const statusQuery = useQuery({ queryKey: STATUS_QUERY_KEY, queryFn: fetchPromptSourceStatuses });

    const [editingSource, setEditingSource] = useState<PromptSource | null>(null);
    const [viewingId, setViewingId] = useState("");
    const [refreshingId, setRefreshingId] = useState("");
    const [refreshingAll, setRefreshingAll] = useState(false);
    const viewingSource = sources.find((item) => item.id === viewingId) || null;
    const intervalOptions = PROMPT_SOURCE_INTERVALS.map((value) => ({ value, label: t(`config.promptSources.intervals.${intervalKey(value)}`) }));

    const invalidatePrompts = async () => {
        await Promise.all([
            queryClient.invalidateQueries({ queryKey: ["prompts"] }),
            queryClient.invalidateQueries({ queryKey: ["side-panel-prompts"] }),
            queryClient.invalidateQueries({ queryKey: STATUS_QUERY_KEY }),
        ]);
    };

    const handleSave = (source: PromptSource) => {
        saveSource(source);
        void invalidatePrompts();
    };

    const handleDelete = (source: PromptSource) => {
        const assertSession = captureSession();
        confirm({
            title: t("config.promptSources.deleteTitle", { name: source.name }),
            content: t("config.promptSources.deleteDescription"),
            confirmText: t("common.delete"),
            destructive: true,
            cancelText: t("common.cancel"),
            onConfirm: async () => {
                assertSession();
                removeSource(source.id);
                await invalidatePrompts();
            },
        });
    };

    const handleRefreshOne = async (source: PromptSource) => {
        setRefreshingId(source.id);
        try {
            const result = await refreshSource(source.id);
            await invalidatePrompts();
            notify.success(t("config.promptSources.refreshed", { name: source.name, count: result.count }));
        } catch (error) {
            await queryClient.invalidateQueries({ queryKey: STATUS_QUERY_KEY });
            notify.error(error instanceof Error ? error.message : t("config.promptSources.refreshFailedCached"));
        } finally {
            setRefreshingId("");
        }
    };

    const handleRefreshAll = async () => {
        const assertSession = captureSession();
        setRefreshingAll(true);
        try {
            const result = await refreshAllSources();
            assertSession();
            await invalidatePrompts();
            if (result.failureCount) notify.warning(t("config.promptSources.refreshPartial", { success: result.successCount, failed: result.failureCount }));
            else notify.success(t("config.promptSources.refreshAllSuccess", { sources: result.successCount, total: result.total }));
        } catch (error) {
            notify.error(error instanceof Error ? error.message : t("config.promptSources.refreshFailed"));
        } finally {
            setRefreshingAll(false);
        }
    };

    const reload = () => {
        const assertSession = captureSession();
        const read = async () => { assertSession(); await usePromptSourceStore.getState().load(true); };
        if (dirty) confirm({ title: appI18n.t("workspace.discardSources"), content: appI18n.t("workspace.reloadSources"), confirmText: appI18n.t("workspace.discardAndReload"), cancelText: appI18n.t("workspace.preserveEdits"), onConfirm: read });
        else void read().catch((error: unknown) => { notify.error(error instanceof Error ? error.message : appI18n.t("workspace.readFailed")); });
    };

    return (
        <section className="space-y-6">
            <PageHeader stickyActions title={t("settings.promptSources")} description={t("settings.promptSourcesDescription")} actions={<>
                <span role="status" className="text-xs text-muted-foreground">{saving ? t("settings.savingChanges") : dirty ? appI18n.t("workspace.unsaved") : hydrated ? appI18n.t("workspace.allSaved") : t("settings.loading")}</span>
                <Button variant="ghost" disabled={saving} onClick={reload}>{appI18n.t("workspace.reload")}</Button>
                <Button variant="ghost" disabled={!hydrated} icon={<RefreshCw className="size-4" />} loading={refreshingAll} onClick={() => void handleRefreshAll()}>{t("config.promptSources.refreshAll")}</Button>
                <Button variant="default" disabled={!hydrated || saving} icon={<Plus className="size-4" />} onClick={() => setEditingSource(addSource())}>{t("config.promptSources.add")}</Button>
                <Button type="submit" form="prompt-source-schedule" disabled={!dirty || !hydrated} loading={saving}>{appI18n.t("workspace.saveSources")}</Button>
            </>} />
            {error ? <Alert type="error" title={error} description={appI18n.t("workspace.sourceDraftDescription")} action={<Button disabled={saving} onClick={reload}>{appI18n.t("workspace.reload")}</Button>} /> : null}
            {statusQuery.error ? <Alert type="error" title={statusQuery.error.message} action={<Button onClick={() => void statusQuery.refetch()}>{t("common.retry")}</Button>} /> : null}

            <DataTable<PromptSource> rowId="id" rows={sources} loading={!hydrated && !error} failed={Boolean(error)} empty={<EmptyState description={t("settings.sourcesEmpty")} />} columns={[
                { title: t("config.promptSources.editor.name"), render: (_, source) => <div className="min-w-40 max-w-72">
                    <div className="flex flex-wrap items-center gap-2"><span className="text-sm font-medium break-words">{source.name}</span>{source.builtIn ? <Tag className="shrink-0">{t("config.promptSources.builtIn")}</Tag> : null}</div>
                    <a className="mt-1 block truncate text-xs text-muted-foreground hover:text-foreground hover:underline" href={source.homepage || source.url} title={source.homepage || source.url} target="_blank" rel="noreferrer">{source.homepage || source.url}</a>
                </div> },
                { title: t("workspace.status"), render: (_, source) => {
                    const status = statusQuery.data?.[source.id];
                    return <div className="min-w-32 space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                            {status?.lastError ? <Tag color="error" title={status.lastError}>{t("config.promptSources.failed")}</Tag> : status?.lastSuccessAt ? <Tag color="success">{t("config.promptSources.healthy")}</Tag> : <Tag>{t("config.promptSources.unsynced")}</Tag>}
                            {status ? <span className="text-xs text-muted-foreground tabular-nums">{t("config.promptSources.itemCount", { count: status.count })}</span> : null}
                        </div>
                        <p className="text-xs leading-5 text-muted-foreground">{status?.lastSuccessAt ? t("config.promptSources.lastSuccess", { time: formatTime(status.lastSuccessAt, i18n.resolvedLanguage) }) : t("config.promptSources.neverFetched")}</p>
                    </div>;
                } },
                { title: t("workspace.enabled"), width: 72, render: (_, source) => <Switch aria-label={`${source.name} · ${t("config.promptSources.editor.enabled")}`} disabled={!hydrated || saving} checked={source.enabled} onChange={(checked) => { toggleSource(source.id, checked); void invalidatePrompts(); }} /> },
                { title: t("workspace.actions"), align: "right", render: (_, source) => <div className="flex flex-wrap justify-end gap-1">
                    <Button variant="ghost" size="sm" icon={<Eye className="size-3.5" />} onClick={() => setViewingId(source.id)}>{t("config.promptSources.view")}</Button>
                    <Button variant="ghost" size="sm" icon={<RefreshCw className="size-3.5" />} loading={refreshingId === source.id} onClick={() => void handleRefreshOne(source)}>{t("config.promptSources.refresh")}</Button>
                    {!source.builtIn ? <Button variant="ghost" size="sm" disabled={saving} icon={<Pencil className="size-3.5" />} onClick={() => setEditingSource(source)}>{t("config.promptSources.edit")}</Button> : null}
                    {!source.builtIn ? <Button variant="ghost" data-destructive size="sm" disabled={saving} icon={<Trash2 className="size-3.5" />} onClick={() => handleDelete(source)}>{t("common.delete")}</Button> : null}
                </div> },
            ]} />

            <section>
                <h2 className="mb-2 text-base font-semibold">{t("config.promptSources.schedule")}</h2>
                <EditorForm id="prompt-source-schedule" disabled={!hydrated || saving} className="space-y-0" onSubmit={() => usePromptSourceStore.getState().save()}>
                    <Field layout="horizontal" label={t("config.promptSources.interval")} description={t("config.promptSources.scheduleDescription")}>
                        <Choice value={schedule.intervalMinutes} options={intervalOptions} onChange={(value) => updateSchedule("intervalMinutes", value)} />
                    </Field>
                </EditorForm>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">{Object.values(statusQuery.data || {}).some((row) => row.lastSuccessAt) ? t("config.promptSources.lastFetched", { time: formatTime(Object.values(statusQuery.data || {}).map((row) => row.lastSuccessAt || "").sort().at(-1)!, i18n.resolvedLanguage) }) : t("config.promptSources.neverScheduled")}</p>
            </section>

            <PromptSourceEditorDrawer open={Boolean(editingSource)} source={editingSource} onSave={handleSave} onClose={() => setEditingSource(null)} />
            <PromptSourceContentModal source={viewingSource} onClose={() => setViewingId("")} />
        </section>
    );
}

function formatTime(value: string, locale?: string) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString(locale, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function intervalKey(value: number) {
    if (value === 30) return "minutes30";
    if (value === 60) return "hour1";
    if (value === 360) return "hours6";
    if (value === 1440) return "hours24";
    return "disabled";
}
