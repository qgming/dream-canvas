import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ChevronDown, RefreshCw, Trash2 } from "lucide-react";
import { Collapsible } from "@animate-ui/react/primitives/radix-ui";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/controls";
import { Badge, EmptyState, Notice, Spinner } from "@/components/ui/display";
import { Field } from "@/components/ui/form";
import { Pagination } from "@/components/ui/pagination";
import { useFeedback } from "@/hooks/use-feedback";
import { useEditGuard } from "@/hooks/use-edit-guard";
import { formatBytes } from "@/lib/image-utils";
import { ApiError, captureSession } from "@/services/api/client";
import { clearLogs, getLogSettings, readLogs, saveLogSettings, type LogSettings } from "@/services/api/logging";

export default function LoggingPage() {
    const { t, i18n } = useTranslation();
    const { notify, confirm } = useFeedback();
    const queryClient = useQueryClient();
    const logError = (error: unknown) => error instanceof ApiError ? t(`logging.errors.${error.code}`, { defaultValue: error.message }) : error instanceof Error ? error.message : t("ui.operationFailed");
    const query = useQuery({ queryKey: ["log-settings"], queryFn: getLogSettings, refetchOnWindowFocus: false, refetchOnReconnect: false });
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(100);
    const [clearing, setClearing] = useState(false);
    const [draft, setDraft] = useState<LogSettings | null>(null);
    const [busy, setBusy] = useState(false);
    const [saveError, setSaveError] = useState<unknown>(null);
    const operation = useRef(false);
    const logs = useQuery({ queryKey: ["server-logs", page, pageSize], queryFn: ({ signal }) => readLogs(page, pageSize, signal), retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false });
    const settings = draft ?? query.data;
    const conflict = saveError instanceof ApiError && saveError.code === "version_conflict";
    useEditGuard(Boolean(draft), () => { setDraft(null); setSaveError(null); });
    useEffect(() => { if (logs.data && Number.isInteger(logs.data.page) && logs.data.page > 0 && logs.data.page !== page) setPage(logs.data.page); }, [logs.data, page]);

    const reload = async () => {
        if (operation.current) return;
        operation.current = true; setBusy(true);
        const assertSession = captureSession();
        try {
            const result = await query.refetch(); assertSession();
            if (result.error) throw result.error;
            if (result.data) { setDraft(null); setSaveError(null); }
        } catch (error) { setSaveError(error); }
        finally { operation.current = false; setBusy(false); }
    };
    const save = async (next: LogSettings) => {
        if (operation.current) return;
        operation.current = true; setBusy(true); setDraft(next); setSaveError(null);
        const assertSession = captureSession();
        try {
            await queryClient.cancelQueries({ queryKey: ["log-settings"] }); assertSession();
            const saved = await saveLogSettings(next); assertSession();
            queryClient.setQueryData(["log-settings"], saved); setDraft(null);
        } catch (error) { setSaveError(error); }
        finally { operation.current = false; setBusy(false); }
    };
    const latest = () => { setPage(1); void queryClient.invalidateQueries({ queryKey: ["server-logs"] }); };
    const clear = () => {
        const assertSession = captureSession();
        confirm({ title: t("logging.clearTitle"), content: t("logging.clearHint"), destructive: true, confirmText: t("logging.clear"), onConfirm: async () => {
            assertSession(); setClearing(true);
            try {
                await queryClient.cancelQueries({ queryKey: ["server-logs"] });
                const result = await clearLogs(); assertSession();
                queryClient.removeQueries({ queryKey: ["server-logs"] });
                queryClient.setQueryData(["server-logs", 1, pageSize], { ...result, page: 1, pageSize, entries: result.entries.slice(0, pageSize) }); setPage(1);
                void queryClient.invalidateQueries({ queryKey: ["server-logs", 1, pageSize], exact: true });
                notify.success(t("logging.cleared"));
            } catch (error) { await queryClient.invalidateQueries({ queryKey: ["server-logs"] }); throw new Error(logError(error)); }
            finally { setClearing(false); }
        } });
    };
    if (query.isLoading) return <Spinner />;
    return <section className="space-y-6">
        <PageHeader title={t("logging.title")} />
        {query.error ? <Notice type="error" title={query.error.message} action={<Button disabled={busy || query.isFetching} onClick={() => void reload()}>{t("workspace.retry")}</Button>} /> : null}
        {saveError && !query.error ? <Notice type={conflict ? "warning" : "error"} title={conflict ? t("logging.conflict") : t("logging.saveFailed")} description={conflict ? undefined : logError(saveError)} action={<Button disabled={busy} onClick={() => { if (conflict || !draft) void reload(); else void save(draft); }}>{t(conflict ? "workspace.reload" : "workspace.retry")}</Button>} /> : null}
        {settings ? <section aria-busy={busy}>
            <h2 className="mb-2 text-base font-medium">{t("logging.output")}</h2>
            <Field layout="horizontal" className="grid-cols-[minmax(0,1fr)_auto] items-center" label={t("logging.enabled")} help={t("logging.enabledHint")}>
                <Switch checked={settings.enabled} disabled={busy || clearing || query.isError || conflict} onChange={(enabled) => void save({ ...settings, enabled, development: enabled && settings.development })} />
            </Field>
            <Field layout="horizontal" className="grid-cols-[minmax(0,1fr)_auto] items-center" label={t("logging.development")} help={t("logging.developmentHint")}>
                <Switch checked={settings.development} disabled={busy || clearing || query.isError || conflict || !settings.enabled} onChange={(development) => void save({ ...settings, development })} />
            </Field>
        </section> : null}
        <section className="space-y-4" aria-label={t("logging.viewer")}>
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1"><h2 className="text-base font-medium">{t("logging.viewer")}</h2><p className="text-xs text-muted-foreground" role="status">{logs.data ? t("logging.usage", { size: formatBytes(logs.data.bytes) || "0 B", count: logs.data.files }) : t(logs.isFetching ? "logging.readUsage" : "logging.usageUnavailable")}</p></div>
                <div className="flex flex-wrap gap-2"><Button variant="outline" icon={<RefreshCw />} loading={logs.isFetching} disabled={clearing} onClick={latest}>{t("logging.refreshLatest")}</Button><Button variant="outline" icon={<Trash2 />} data-destructive loading={clearing} disabled={logs.isFetching || busy || (!logs.error && logs.data?.bytes === 0)} onClick={clear}>{t("logging.clear")}</Button></div>
            </div>
            {logs.data?.storageError ? <Notice type="warning" title={t(`logging.storageErrors.${logs.data.storageError}`)} /> : null}
            {logs.error ? <Notice type="error" title={logError(logs.error)} action={<Button disabled={clearing} onClick={latest}>{t("logging.refreshLatest")}</Button>} /> : null}
            {logs.isPending ? <div className="flex min-h-32 items-center justify-center"><Spinner /></div> : logs.data && !logs.error ? <>
                <div className="overflow-hidden rounded-xl border border-border bg-card">
                    {logs.data.entries.map((entry, index) => <Collapsible.Root key={`${page}:${entry.time}:${index}`} className="group border-b border-border last:border-b-0">
                        <Collapsible.Trigger asChild><button type="button" className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-left text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                            <time className="text-xs tabular-nums text-muted-foreground" dateTime={entry.time}>{new Date(entry.time).toLocaleString(i18n.resolvedLanguage)}</time><Badge color={entry.level === "ERROR" ? "error" : entry.level === "WARN" ? "warning" : undefined}>{t(`logging.levels.${entry.level}`, { defaultValue: entry.level })}</Badge><span className="min-w-0 flex-1 break-words font-mono text-xs">{entry.msg}</span><ChevronDown className="size-4 shrink-0 transition-transform group-data-[state=open]:rotate-180" />
                        </button></Collapsible.Trigger>
                        <Collapsible.Content><pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words px-3 pb-3 text-xs leading-6 text-muted-foreground">{JSON.stringify(entry, null, 2)}</pre></Collapsible.Content>
                    </Collapsible.Root>)}
                    {!logs.data.entries.length ? <EmptyState description={t("logging.empty")} /> : null}
                </div>
                <Pagination current={logs.data.page} pageSize={pageSize} total={logs.data.total} onChange={setPage} onPageSizeChange={(size) => { setPage(1); setPageSize(size); }} />
            </> : null}
        </section>
    </section>;
}
