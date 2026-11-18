import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { dequal } from "dequal";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/display";
import { EditorForm, Field, useEditorForm, useWatch } from "@/components/ui/form";
import { Input, Textarea } from "@/components/ui/input";
import { Choice } from "@/components/ui/choice";
import { ModelConfigurationFields, blankModel, defaultAdapter } from "@/components/model-configuration-fields";
import { ModelScriptTestDialog } from "@/components/model-script-test-dialog";
import { createModelScript, discoverModels, getModelScript, listModelScripts, saveModel, saveModels, type Capability, type ChannelEntry, type ModelInput, type ModelScript, type ServerModel } from "@/services/api/channels";
import { ScriptEditor } from "@/pages/settings/model-scripts/components/script-editor";
import { useFeedback } from "@/hooks/use-feedback";
import { useEditGuard } from "@/hooks/use-edit-guard";
import { ApiError, captureSession } from "@/services/api/client";
import { applyInputOverrides } from "@/lib/model-inputs";

export function ModelDialog({ entry, model, onClose, onSaved }: { entry: ChannelEntry; model?: ServerModel; onClose: () => void; onSaved: () => Promise<void> }) {
    const { t } = useTranslation();
    const { notify } = useFeedback();
    const client = useQueryClient();
    const [rows, setRows] = useState<ModelInput[]>(model ? [model] : []);
    const [selected, setSelected] = useState(model ? 0 : -1);
    const [busy, setBusy] = useState(false);
    const [remote, setRemote] = useState<string[] | null>(null);
    const [loadingRemote, setLoadingRemote] = useState(false);
    const [remoteError, setRemoteError] = useState("");
    const [scriptEditor, setScriptEditor] = useState<ModelScript | null>(null);
    const [scriptVersion, setScriptVersion] = useState("");
    const [scriptTask, setScriptTask] = useState("");
    const [suspended, setSuspended] = useState(false);
    const [create, setCreate] = useState<Capability | null>(null);
    const [scriptBusy, setScriptBusy] = useState(false);
    const [test, setTest] = useState(false);
    const [preview, setPreview] = useState(false);
    const [testTask, setTestTask] = useState<{ id: string; adapterId: string; versionId: string } | null>(null);
    const form = useEditorForm<ModelInput>(model || blankModel());
    const sourceForm = useEditorForm({ manualId: "", manualName: "", remote: [] as string[], bulkType: "image" as Capability, bulkAdapter: "openai-image" });
    const current = useWatch({ control: form.control }) as ModelInput;
    const scripts = useQuery({ queryKey: ["model-scripts"], queryFn: listModelScripts });
    const script = useQuery({ queryKey: ["model-script", current.adapterId], queryFn: () => getModelScript(current.adapterId), enabled: Boolean(current.adapterId) });
    const source = useWatch({ control: sourceForm.control });
    const bulkType = source.bulkType || "image";
    const staged = () => rows.map((row, index) => index === selected ? { ...row, ...form.getValues() } : row);
    const dirty = !dequal(staged(), model ? [model] : []) || Boolean(source.manualId || source.manualName || source.remote?.length);
    useEditGuard(dirty, onClose);
    const select = (index: number) => { const next = staged(); setRows(next); setSelected(index); form.reset(next[index]); };
    const append = (models: { model: string; name: string }[]) => {
        const next = staged(), exists = new Set([...entry.models.map((item) => item.model), ...next.map((item) => item.model)]);
        const added = models.filter((item) => { const id = item.model.trim(); if (!id || exists.has(id)) return false; exists.add(id); return true; }).map((item) => ({ ...blankModel(bulkType), model: item.model.trim(), name: item.name.trim(), adapterId: sourceForm.getValues("bulkAdapter") || defaultAdapter(bulkType) }));
        if (!added.length) throw new Error(t("modelScripts.modelsAlreadyAdded"));
        const index = next.length; setRows([...next, ...added]); setSelected(index); form.reset(added[0]);
    };
    const remoteFetch = async () => { if (loadingRemote) return; const assertSession = captureSession(); setLoadingRemote(true); setRemoteError(""); try { const models = await discoverModels(entry.channel.id); assertSession(); setRemote(models); } catch (failure) { setRemoteError(failure instanceof Error ? failure.message : String(failure)); } finally { setLoadingRemote(false); } };
    const viewScript = async (id: string, task?: { id: string; versionId: string }) => { const assertSession = captureSession(); try { const value = await client.fetchQuery({ queryKey: ["model-script", id], queryFn: () => getModelScript(id) }); assertSession(); setScriptVersion(task?.versionId ?? (current.adapterId === id ? current.adapterVersionId : "")); setScriptTask(task?.id || ""); setScriptEditor(value.script); } catch (failure) { notify.error(failure instanceof Error ? failure.message : String(failure)); } };
    const version = script.data?.versions.find((version) => version.id === current.adapterVersionId);
    const ready = selected >= 0 && Boolean(version) && !scripts.error && !script.error;
    const save = async () => {
        const assertSession = captureSession(); setBusy(true);
        try {
            const prepared = staged();
            const invalid = prepared.findIndex((row) => !row.model.trim() || !row.name.trim() || !row.adapterId);
            if (invalid >= 0) { select(invalid); throw new Error(t("modelScripts.invalidPending", { model: prepared[invalid].model || invalid + 1 })); }
            if (!ready) throw new Error(t("modelScripts.versionMissing"));
            if (model) await saveModel(entry.channel.id, model.id, prepared[0]);
            else await saveModels(entry.channel.id, prepared);
            assertSession(); form.reset(form.getValues()); onClose(); notify.success(t("workspace.modelSaved")); await onSaved();
        } catch (failure) { if (failure instanceof ApiError && /^model_row_\d+$/.test(failure.code)) select(Number(failure.code.slice("model_row_".length))); throw failure; }
        finally { setBusy(false); }
    };
    return <><Dialog open={!suspended} title={t(model ? "workspace.editModel" : "workspace.addModel")} description={entry.channel.name} onClose={onClose} busy={busy} dirty={dirty} width={960} footer={<><Button variant="ghost" disabled={!ready || busy || scriptBusy} onClick={() => setPreview(true)}>{t("modelScripts.previewRequest")}</Button><Button variant="ghost" disabled={!ready || busy || scriptBusy} onClick={() => setTest(true)}>{t("modelScripts.testModel")}</Button><Button type="submit" form="channel-model" loading={busy} disabled={!ready || scriptBusy}>{t("common.save")}{!model && rows.length ? ` (${rows.length})` : ""}</Button></>}>
        {testTask ? <Notice type="info" title={t("modelScripts.testQueued")} action={<Button onClick={() => void viewScript(testTask.adapterId, testTask)}>{t("modelScripts.evidence")}</Button>} /> : null}
        {!model ? <div className="mb-6 space-y-4">
            <EditorForm id="model-sources" form={sourceForm} onSubmit={(values) => { append([{ model: values.manualId.trim(), name: values.manualName.trim() || values.manualId.trim() }]); sourceForm.reset({ ...values, manualId: "", manualName: "" }); }}>
                <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm font-medium">{t("modelScripts.remoteModels")}</p><Button loading={loadingRemote} onClick={() => void remoteFetch()}>{t("modelScripts.fetchModels")}</Button></div>
                {remoteError ? <Notice type="error" title={remoteError} action={<Button onClick={() => void remoteFetch()}>{t("workspace.retry")}</Button>} /> : null}
                {remote !== null ? <div className="space-y-2"><Field name="remote" label={t("modelScripts.remoteResults", { count: remote.length })}><Choice multiple searchable options={remote.filter((id) => !entry.models.some((item) => item.model === id)).map((id) => ({ value: id, label: id }))} /></Field><Button size="sm" onClick={() => { try { append((sourceForm.getValues("remote") as string[]).map((id) => ({ model: id, name: id }))); sourceForm.setValue("remote", [], { shouldDirty: false }); } catch (failure) { notify.error(failure instanceof Error ? failure.message : String(failure)); } }}>{t("modelScripts.addSelected")}</Button></div> : null}
                <p className="text-xs leading-5 text-muted-foreground">{t("modelScripts.remoteHint")}</p>
                <div className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]"><Field name="manualId" label={t("workspace.providerModelId")} schema={z.string().trim().min(1)}><Input /></Field><Field name="manualName" label={t("workspace.displayName")}><Input /></Field><Button type="submit">{t("modelScripts.addManual")}</Button></div>
                <div className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]"><Field name="bulkType" label={t("modelScripts.batchType")}><Choice options={["text", "image", "video", "audio"].map((value) => ({ value, label: t(value === "audio" ? "modelScripts.tts" : `workspace.${value}`) }))} onChange={(capability: Capability) => sourceForm.setValue("bulkAdapter", defaultAdapter(capability), { shouldDirty: false })} /></Field><Field name="bulkAdapter" label={t("modelScripts.callAdapter")}><Choice options={scripts.data?.filter((script) => script.capability === bulkType && script.adapterVersionId).map((script) => ({ value: script.id, label: script.name }))} /></Field><Button onClick={() => { const adapterId = sourceForm.getValues("bulkAdapter") || defaultAdapter(bulkType); const next = staged().map((row) => ({ ...row, capability: bulkType, adapterId, adapterVersionId: "", parameterOverrides: {} })); setRows(next); if (selected >= 0) form.reset(next[selected]); }}>{t("modelScripts.applyAll")}</Button></div>
            </EditorForm>
            {rows.length ? <div className="flex max-h-40 flex-wrap gap-2 overflow-auto">{rows.map((row, index) => <div key={index} className={`flex items-center gap-1 rounded-md border px-1 ${index === selected ? "border-ring bg-accent" : "border-border"}`}><Button size="sm" variant="ghost" onClick={() => select(index)}>{row.name || row.model}<span className="ml-1 text-xs text-muted-foreground">{t(row.capability === "audio" ? "modelScripts.tts" : `workspace.${row.capability}`)}</span></Button><Button size="sm" variant="ghost" aria-label={t("common.delete")} onClick={() => { const next = staged().filter((_, item) => item !== index); setRows(next); const target = next.length ? Math.min(selected, next.length - 1) : -1; setSelected(target); form.reset(target >= 0 ? next[target] : blankModel()); }}>×</Button></div>)}</div> : null}
        </div> : null}
        {selected >= 0 ? <EditorForm id="channel-model" form={form} onSubmit={save}><ModelConfigurationFields onCreateScript={setCreate} onViewScript={(id) => void viewScript(id)} /></EditorForm> : <p className="py-6 text-sm text-muted-foreground">{t("modelScripts.pendingEmpty")}</p>}
        <Dialog title={t("modelScripts.create")} open={Boolean(create)} busy={scriptBusy} onClose={() => setCreate(null)} footer={<Button type="submit" form="model-new-script" loading={scriptBusy}>{t("common.save")}</Button>}>{create ? <EditorForm id="model-new-script" initialValues={{ name: current.name || current.model || "", description: "" }} onSubmit={async (values) => { const assertSession = captureSession(); setScriptBusy(true); try { const created = await createModelScript({ ...values, capability: create }); assertSession(); await scripts.refetch(); setCreate(null); setScriptVersion(""); setScriptTask(""); setScriptEditor(created); } finally { setScriptBusy(false); } }}><Field name="name" label={t("workspace.name")} schema={z.string().trim().min(1)}><Input /></Field><Field name="description" label={t("modelScripts.scriptDescription")}><Textarea /></Field></EditorForm> : null}</Dialog>
        <Dialog title={scriptEditor?.name || t("modelScripts.title")} open={Boolean(scriptEditor) && !suspended} busy={scriptBusy} width={1100} onClose={() => setScriptEditor(null)} footer={null}>{scriptEditor ? <ScriptEditor key={`${scriptEditor.id}:${scriptVersion}:${scriptTask}`} script={scriptEditor} initialVersionId={scriptVersion} initialTaskId={scriptTask} onBusyChange={setScriptBusy} onAssistantOpen={() => setSuspended(true)} modelContext={{ model: current.model, name: current.name, baseUrl: entry.channel.baseUrl }} onPublished={async (version) => { await Promise.all([client.invalidateQueries({ queryKey: ["model-scripts"] }), client.invalidateQueries({ queryKey: ["model-script", scriptEditor.id] })]); form.setValue("adapterId", scriptEditor.id, { shouldDirty: true }); form.setValue("adapterVersionId", version.id, { shouldDirty: true }); form.setValue("parameterOverrides", {}, { shouldDirty: true }); notify.success(t("modelScripts.selectedForModel")); }} /> : null}</Dialog>
        {(test || preview) && script.data && version ? <ModelScriptTestDialog script={script.data.script} controls={applyInputOverrides(version.parameters, current.parameterOverrides)} preview={preview ? { files: version.files, baseUrl: entry.channel.baseUrl } : undefined} initial={{ channelId: entry.channel.id, model: form.getValues() }} onClose={() => { setTest(false); setPreview(false); }} onQueued={(id) => setTestTask({ id, adapterId: current.adapterId, versionId: current.adapterVersionId })} /> : null}
    </Dialog>{suspended ? <div className="fixed bottom-4 left-1/2 z-[120] flex -translate-x-1/2 items-center gap-3 rounded-lg border border-border bg-popover px-4 py-3 text-sm shadow-lg"><span>{t("modelScripts.draftRetained")}</span><Button onClick={() => setSuspended(false)}>{t("modelScripts.returnToModel")}</Button></div> : null}</>;
}
