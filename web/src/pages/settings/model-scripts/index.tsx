import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { z } from "zod";
import { Copy, Download, Ellipsis, FileUp, Plus, RefreshCw, Save, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Notice, Badge } from "@/components/ui/display";
import { DataTable } from "@/components/ui/data-table";
import { Dialog } from "@/components/ui/dialog";
import { EditorForm, Field } from "@/components/ui/form";
import { Input, Textarea } from "@/components/ui/input";
import { Choice } from "@/components/ui/choice";
import { Menu } from "@/components/ui/popover";
import { createModelScript, getModelScript, listModelScripts, type ModelScript } from "@/services/api/channels";
import { captureSession } from "@/services/api/client";
import { useFeedback } from "@/hooks/use-feedback";
import { ScriptEditor } from "./components/script-editor";
import { exportScriptFiles, importScriptPackage } from "./components/script-package";
import { useDeleteScript } from "./use-delete-script";

export default function ModelScriptsPage() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const { id } = useParams();
    const [search] = useSearchParams();
    const versionId = search.get("version") || "";
    const taskId = search.get("task") || "";
    const { notify } = useFeedback();
    const client = useQueryClient();
    const query = useQuery({ queryKey: ["model-scripts"], queryFn: listModelScripts });
    const [create, setCreate] = useState(false);
    const [busy, setBusy] = useState(false);
    const { remove, deleting } = useDeleteScript();
    const importInput = useRef<HTMLInputElement>(null), operation = useRef(false);
    const selected = query.data?.find((script) => script.id === id);
    const run = async (action: () => Promise<void>) => {
        if (operation.current || busy || deleting) return;
        operation.current = true; setBusy(true);
        try { await action(); }
        catch (error) { notify.error(error instanceof Error ? error.message : String(error)); }
        finally { operation.current = false; setBusy(false); }
    };
    const openCreated = (script: ModelScript) => {
        client.setQueryData<ModelScript[]>(["model-scripts"], (rows) => [...(rows || []), script]);
        void client.invalidateQueries({ queryKey: ["model-scripts"] });
        navigate(`/settings/model-scripts/${script.id}`);
    };
    const importFile = (file?: File) => file && run(async () => {
        const assertSession = captureSession(), files = await importScriptPackage(file);
        assertSession();
        const script = await createModelScript({ files });
        assertSession(); openCreated(script);
    });
    const download = (source: ModelScript) => run(async () => {
        const assertSession = captureSession(), detail = await getModelScript(source.id);
        assertSession(); exportScriptFiles(detail.draft.files, detail.script.name);
    });
    const duplicate = (source: ModelScript) => run(async () => {
        if (source.builtin) return;
        const assertSession = captureSession(), scripts = await listModelScripts();
        assertSession();
        const current = scripts.find((script) => script.id === source.id);
        if (!current || current.builtin) throw new Error(t("modelScripts.notFound"));
        const base = current.name.replace(/ \(\d+\)$/, ""), names = new Set(scripts.map((script) => script.name));
        let index = 2;
        while (names.has(`${base} (${index})`)) index++;
        const script = await createModelScript({ name: `${base} (${index})`, capability: current.capability, description: current.description, copyFrom: current.id });
        assertSession();
        client.setQueryData(["model-scripts"], scripts);
        openCreated(script); notify.success(t("modelScripts.copyCreated", { name: script.name }));
    });
    if (selected) return <ScriptEditor key={`${selected.id}:${versionId}:${taskId}`} script={selected} initialVersionId={versionId} initialTaskId={taskId} onBusyChange={setBusy} onBack={() => navigate("/settings/model-scripts")} />;
    return <section className="space-y-6"><PageHeader title={t("modelScripts.title")} actions={<><Button variant="outline" icon={<RefreshCw />} loading={query.isFetching} disabled={busy || Boolean(deleting)} onClick={() => void query.refetch()}>{t("workspace.refresh")}</Button><Button variant="outline" icon={<FileUp />} disabled={busy || Boolean(deleting)} onClick={() => importInput.current?.click()}>{t("modelScripts.importFiles")}</Button><Button variant="default" icon={<Plus />} disabled={busy || Boolean(deleting)} onClick={() => setCreate(true)}>{t("modelScripts.create")}</Button></>} />
        <input ref={importInput} type="file" hidden accept=".zip" onChange={(event) => { void importFile(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }} />
        {query.error ? <Notice type="error" title={query.error.message} action={<Button onClick={() => void query.refetch()}>{t("workspace.retry")}</Button>} /> : null}
        {id && !query.isLoading && !query.error ? <Notice type="error" title={t("modelScripts.notFound")} /> : null}
        <DataTable<ModelScript> rowId="id" loading={query.isLoading} failed={query.isError} rows={query.data} columns={[
            { title: t("workspace.name"), dataIndex: "name" },
            { title: t("workspace.type"), render: (_, row) => t(row.capability === "audio" ? "modelScripts.tts" : `workspace.${row.capability}`) },
            { title: t("workspace.status"), render: (_, row) => <div className="flex gap-2"><Badge>{t(row.builtin ? "modelScripts.builtin" : "modelScripts.custom")}</Badge><Badge>{t(row.adapterVersionId ? "modelScripts.published" : "modelScripts.draft")}</Badge></div> },
            { title: t("workspace.actions"), align: "right", render: (_, row) => <div className="flex justify-end gap-2">
                <Button size="sm" variant="outline" disabled={busy || Boolean(deleting)} onClick={() => navigate(`/settings/model-scripts/${row.id}`)}>{t(row.builtin ? "modelScripts.view" : "common.edit")}</Button>
                <Menu placement="bottomRight" disabled={busy || Boolean(deleting)} items={[
                    { key: "export", label: t("modelScripts.exportPackage"), icon: <Download />, onClick: () => void download(row) },
                    ...(!row.builtin ? [
                        { key: "copy", label: t("modelScripts.copy"), icon: <Copy />, disabled: query.isError, onClick: () => void duplicate(row) },
                        { key: "delete", label: t("common.delete"), icon: <Trash2 />, danger: true, disabled: query.isError, onClick: () => remove(row) },
                    ] : []),
                ]}><Button variant="outline" size="icon" className="size-7" disabled={busy || Boolean(deleting)} loading={deleting === row.id} title={t("ui.moreActions")} aria-label={t("ui.moreActions")}><Ellipsis /></Button></Menu>
            </div> },
        ]} />
        <Dialog title={t("modelScripts.create")} open={create} busy={busy} onClose={() => setCreate(false)} footer={<Button variant="default" icon={<Save />} type="submit" form="create-model-script" loading={busy}>{t("common.save")}</Button>}>{create ? <EditorForm id="create-model-script" initialValues={{ name: "", capability: "video", description: "" }} onSubmit={(values) => run(async () => { const assertSession = captureSession(), script = await createModelScript(values); assertSession(); setCreate(false); openCreated(script); })}><Field name="name" label={t("workspace.name")} schema={z.string().trim().min(1)}><Input /></Field><Field name="capability" label={t("workspace.type")}><Choice options={["text", "image", "video", "audio"].map((value) => ({ value, label: t(value === "audio" ? "modelScripts.tts" : `workspace.${value}`) }))} /></Field><Field name="description" label={t("modelScripts.scriptDescription")}><Textarea /></Field></EditorForm> : null}</Dialog>
    </section>;
}
