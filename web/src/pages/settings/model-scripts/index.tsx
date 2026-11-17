import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { z } from "zod";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Notice, Badge } from "@/components/ui/display";
import { DataTable } from "@/components/ui/data-table";
import { Dialog } from "@/components/ui/dialog";
import { EditorForm, Field } from "@/components/ui/form";
import { Input, Textarea } from "@/components/ui/input";
import { Choice } from "@/components/ui/choice";
import { createModelScript, listModelScripts, type ModelScript } from "@/services/api/channels";
import { captureSession } from "@/services/api/client";
import { useFeedback } from "@/hooks/use-feedback";
import { ScriptEditor } from "./components/script-editor";
import { importScriptFiles } from "./components/script-package";

export default function ModelScriptsPage() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const { id } = useParams();
    const [search] = useSearchParams();
    const versionId = search.get("version") || "";
    const taskId = search.get("task") || "";
    const { notify } = useFeedback();
    const query = useQuery({ queryKey: ["model-scripts"], queryFn: listModelScripts });
    const [create, setCreate] = useState<{ source?: ModelScript } | null>(null);
    const [busy, setBusy] = useState(false);
    const importInput = useRef<HTMLInputElement>(null), folderInput = useRef<HTMLInputElement>(null);
    const selected = query.data?.find((script) => script.id === id);
    const importFiles = async (files: File[]) => { if (!files.length || busy) return; const assertSession = captureSession(); setBusy(true); try { const script = await createModelScript({ files: await importScriptFiles(files) }); assertSession(); await query.refetch(); navigate(`/settings/model-scripts/${script.id}`); } catch (error) { notify.error(error instanceof Error ? error.message : String(error)); } finally { setBusy(false); } };
    if (selected) return <section className="space-y-5"><PageHeader title={selected.name} actions={<Button variant="ghost" disabled={busy} onClick={() => navigate("/settings/model-scripts")}>{t("modelScripts.back")}</Button>} /><ScriptEditor key={`${selected.id}:${versionId}:${taskId}`} script={selected} initialVersionId={versionId} initialTaskId={taskId} onBusyChange={setBusy} /></section>;
    return <section className="space-y-6"><PageHeader title={t("modelScripts.title")} description={t("modelScripts.description")} actions={<><Button variant="ghost" loading={query.isFetching} onClick={() => void query.refetch()}>{t("workspace.refresh")}</Button><Button disabled={busy} onClick={() => importInput.current?.click()}>{t("modelScripts.importFiles")}</Button><Button disabled={busy} onClick={() => folderInput.current?.click()}>{t("modelScripts.importFolder")}</Button><Button disabled={busy} onClick={() => setCreate({})}>{t("modelScripts.create")}</Button></>} />
        <input ref={importInput} type="file" hidden multiple accept=".js,.json,.zip" onChange={(event) => { void importFiles(Array.from(event.currentTarget.files || [])); event.currentTarget.value = ""; }} /><input ref={folderInput} type="file" hidden multiple {...{ webkitdirectory: "" }} onChange={(event) => { void importFiles(Array.from(event.currentTarget.files || [])); event.currentTarget.value = ""; }} />
        {query.error ? <Notice type="error" title={query.error.message} action={<Button onClick={() => void query.refetch()}>{t("workspace.retry")}</Button>} /> : null}
        {id && !query.isLoading && !query.error ? <Notice type="error" title={t("modelScripts.notFound")} /> : null}
        <DataTable<ModelScript> rowId="id" loading={query.isLoading} failed={query.isError} rows={query.data} columns={[{ title: t("workspace.name"), dataIndex: "name" }, { title: t("workspace.type"), render: (_, row) => t(row.capability === "audio" ? "modelScripts.tts" : `workspace.${row.capability}`) }, { title: t("workspace.status"), render: (_, row) => <div className="flex gap-2"><Badge>{t(row.builtin ? "modelScripts.builtin" : "modelScripts.custom")}</Badge><Badge>{t(row.adapterVersionId ? "modelScripts.published" : "modelScripts.draft")}</Badge></div> }, { title: t("workspace.actions"), align: "right", render: (_, row) => <div className="flex justify-end gap-2"><Button size="sm" variant="ghost" onClick={() => navigate(`/settings/model-scripts/${row.id}`)}>{t(row.builtin ? "modelScripts.view" : "common.edit")}</Button>{!row.builtin ? <Button size="sm" variant="ghost" onClick={() => setCreate({ source: row })}>{t("modelScripts.copy")}</Button> : null}</div> }]} />
        <Dialog title={t(create?.source ? "modelScripts.copy" : "modelScripts.create")} open={Boolean(create)} busy={busy} onClose={() => setCreate(null)} footer={<Button type="submit" form="create-model-script" loading={busy}>{t("common.save")}</Button>}>{create ? <EditorForm id="create-model-script" initialValues={{ name: create.source ? `${create.source.name} (${t("modelScripts.custom")})` : "", capability: create.source?.capability || "video", description: create.source?.description || "" }} onSubmit={async (values) => { const assertSession = captureSession(); setBusy(true); try { const script = await createModelScript({ ...values, copyFrom: create.source?.id }); assertSession(); setCreate(null); await query.refetch(); navigate(`/settings/model-scripts/${script.id}`); } finally { setBusy(false); } }}><Field name="name" label={t("workspace.name")} schema={z.string().trim().min(1)}><Input /></Field><Field name="capability" label={t("workspace.type")}><Choice disabled={Boolean(create.source)} options={["text", "image", "video", "audio"].map((value) => ({ value, label: t(value === "audio" ? "modelScripts.tts" : `workspace.${value}`) }))} /></Field><Field name="description" label={t("modelScripts.scriptDescription")}><Textarea /></Field></EditorForm> : null}</Dialog>
    </section>;
}
