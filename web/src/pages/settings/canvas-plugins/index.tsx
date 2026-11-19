import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { z } from "zod";

import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Badge, Notice } from "@/components/ui/display";
import { DataTable } from "@/components/ui/data-table";
import { Dialog } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/controls";
import { EditorForm, Field } from "@/components/ui/form";
import { Input, Textarea } from "@/components/ui/input";
import { useFeedback } from "@/hooks/use-feedback";
import { captureSession } from "@/services/api/client";
import { createCanvasPlugin, deleteCanvasPlugin, listCanvasPlugins, setCanvasPluginEnabled, type CanvasPluginRecord } from "@/services/api/canvas-plugins";
import { PluginEditor } from "./components/plugin-editor";

export default function CanvasPluginsPage() {
    const { t } = useTranslation();
    const { id } = useParams();
    const navigate = useNavigate();
    const client = useQueryClient();
    const { notify, confirm } = useFeedback();
    const query = useQuery({ queryKey: ["canvas-plugins"], queryFn: listCanvasPlugins });
    const [create, setCreate] = useState(false);
    const [busy, setBusy] = useState("");
    const refresh = () => Promise.all([query.refetch(), client.invalidateQueries({ queryKey: ["canvas-plugin-catalog"] })]);
    const run = async (row: CanvasPluginRecord, action: () => Promise<unknown>) => {
        const assertSession = captureSession();
        setBusy(row.id);
        try { await action(); assertSession(); await refresh(); }
        catch (error) { notify.error(error instanceof Error ? error.message : String(error)); }
        finally { setBusy(""); }
    };
    const remove = (row: CanvasPluginRecord) => confirm({ title: t("nodePlugins.deleteTitle", { name: row.name }), content: t("nodePlugins.deleteHint"), destructive: true, onConfirm: async () => { const assertSession = captureSession(); setBusy(row.id); try { await deleteCanvasPlugin(row.id, row.version); assertSession(); await refresh(); notify.success(t("nodePlugins.deleted")); } finally { setBusy(""); } } });
    if (id) return <PluginEditor key={id} id={id} />;
    return <section className="space-y-6">
        <PageHeader title={t("nodePlugins.title")} description={t("nodePlugins.description")} actions={<><Button variant="ghost" loading={query.isFetching} onClick={() => void query.refetch()}>{t("workspace.refresh")}</Button><Button disabled={Boolean(busy)} onClick={() => setCreate(true)}>{t("nodePlugins.create")}</Button></>} />
        {query.error ? <Notice type="error" title={query.error.message} action={<Button onClick={() => void query.refetch()}>{t("workspace.retry")}</Button>} /> : null}
        <DataTable<CanvasPluginRecord> rowId="id" rows={query.data} loading={query.isLoading} failed={query.isError} columns={[
            { title: t("workspace.name"), render: (_, row) => <div><p className="font-medium">{row.builtin ? t(`nodePlugins.builtins.${row.id}`) : row.name}</p>{row.description ? <p className="mt-1 max-w-md text-xs leading-5 text-muted-foreground">{row.description}</p> : null}</div> },
            { title: t("nodePlugins.nodeTypes"), render: (_, row) => <span className="text-xs text-muted-foreground">{row.nodes.map((node) => node.type).join(", ")}</span> },
            { title: t("workspace.status"), render: (_, row) => <div className="flex flex-wrap gap-2"><Badge>{t(row.builtin ? "modelScripts.builtin" : "modelScripts.custom")}</Badge><Badge>{t(row.publishedVersionId ? "modelScripts.published" : "modelScripts.draft")}</Badge></div> },
            { title: t("nodePlugins.enabled"), render: (_, row) => <Switch checked={row.enabled} aria-label={t("nodePlugins.toggle", { name: row.builtin ? t(`nodePlugins.builtins.${row.id}`) : row.name })} disabled={Boolean(busy) || !row.publishedVersionId || query.isError} loading={busy === row.id} onChange={(enabled) => void run(row, () => setCanvasPluginEnabled(row.id, row.version, enabled))} /> },
            { title: t("workspace.actions"), align: "right", render: (_, row) => <div className="flex justify-end gap-1"><Button size="sm" variant="ghost" disabled={Boolean(busy)} onClick={() => navigate(`/settings/canvas-plugins/${row.id}`)}>{t(row.builtin ? "nodePlugins.view" : "common.edit")}</Button>{!row.builtin ? <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" disabled={Boolean(busy) || query.isError} onClick={() => remove(row)}>{t("common.delete")}</Button> : null}</div> },
        ]} />
        <Dialog open={create} title={t("nodePlugins.create")} busy={Boolean(busy)} onClose={() => setCreate(false)} footer={<Button type="submit" form="create-canvas-plugin" loading={busy === "create"}>{t("common.save")}</Button>}>
            {create ? <EditorForm id="create-canvas-plugin" initialValues={{ name: "", description: "" }} onSubmit={async (values) => { const assertSession = captureSession(); setBusy("create"); try { const row = await createCanvasPlugin(values); assertSession(); setCreate(false); await refresh(); navigate(`/settings/canvas-plugins/${row.id}`); } finally { setBusy(""); } }}><Field name="name" label={t("workspace.name")} schema={z.string().trim().min(1)}><Input /></Field><Field name="description" label={t("nodePlugins.pluginDescription")}><Textarea /></Field></EditorForm> : null}
        </Dialog>
    </section>;
}
