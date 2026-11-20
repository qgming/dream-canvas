import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { RefreshCw } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/display";
import { DataTable } from "@/components/ui/data-table";
import { Switch } from "@/components/ui/controls";
import { useFeedback } from "@/hooks/use-feedback";
import { captureSession } from "@/services/api/client";
import { listCanvasPlugins, setCanvasPluginEnabled, type CanvasPluginRecord } from "@/services/api/canvas-plugins";

export default function CanvasPluginsPage() {
    const { t } = useTranslation();
    const client = useQueryClient();
    const { notify } = useFeedback();
    const query = useQuery({ queryKey: ["canvas-plugins"], queryFn: listCanvasPlugins });
    const [busy, setBusy] = useState("");
    const operation = useRef(false);
    const refresh = () => Promise.all([query.refetch(), client.invalidateQueries({ queryKey: ["canvas-plugin-catalog"] })]);
    const toggle = async (row: CanvasPluginRecord, enabled: boolean) => {
        if (operation.current) return;
        operation.current = true;
        const assertSession = captureSession();
        setBusy(row.id);
        try { await setCanvasPluginEnabled(row.id, row.version, enabled); assertSession(); await refresh(); }
        catch (error) { notify.error(error instanceof Error ? error.message : String(error)); }
        finally { operation.current = false; setBusy(""); }
    };
    return <section className="space-y-6">
        <PageHeader title={t("nodePlugins.title")} actions={<Button variant="outline" icon={<RefreshCw />} loading={query.isFetching} disabled={Boolean(busy)} onClick={() => void refresh()}>{t("workspace.refresh")}</Button>} />
        {query.error ? <Notice type="error" title={query.error.message} action={<Button onClick={() => void query.refetch()}>{t("workspace.retry")}</Button>} /> : null}
        <DataTable<CanvasPluginRecord> rowId="id" rows={query.data} loading={query.isLoading} failed={query.isError} columns={[
            { title: t("workspace.name"), render: (_, row) => <div><p className="font-medium">{row.builtin ? t(`nodePlugins.builtins.${row.id}`) : row.name}</p>{row.description ? <p className="mt-1 max-w-md text-xs leading-5 text-muted-foreground">{row.description}</p> : null}</div> },
            { title: t("nodePlugins.nodeTypes"), render: (_, row) => <span className="text-xs text-muted-foreground">{row.nodes.map((node) => node.type).join(", ")}</span> },
            { title: t("nodePlugins.enabled"), align: "right", render: (_, row) => <div className="flex justify-end"><Switch checked={row.enabled} aria-label={t("nodePlugins.toggle", { name: row.builtin ? t(`nodePlugins.builtins.${row.id}`) : row.name })} disabled={Boolean(busy) || !row.publishedVersionId || query.isError} loading={busy === row.id} onChange={(enabled) => void toggle(row, enabled)} /></div> },
        ]} />
    </section>;
}
