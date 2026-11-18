import { useState } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormProvider } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { dequal } from "dequal";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Badge, Notice } from "@/components/ui/display";
import { EditorForm, Field, useEditorForm, useWatch } from "@/components/ui/form";
import { Input, SearchInput, Textarea } from "@/components/ui/input";
import { Choice } from "@/components/ui/choice";
import { Tabs } from "@/components/ui/tabs";
import { ModelConfigurationFields, blankModel, defaultAdapter } from "@/components/model-configuration-fields";
import { ModelScriptTestDialog } from "@/components/model-script-test-dialog";
import { createModelScript, discoverModels, getModelScript, listModelScripts, saveModel, saveModels, type Capability, type ChannelEntry, type ModelInput, type ModelScript, type ServerModel } from "@/services/api/channels";
import { ScriptEditor } from "@/pages/settings/model-scripts/components/script-editor";
import { useFeedback } from "@/hooks/use-feedback";
import { useEditGuard } from "@/hooks/use-edit-guard";
import { ApiError, captureSession } from "@/services/api/client";
import { applyInputOverrides } from "@/lib/model-inputs";

const capabilities: Capability[] = ["text", "image", "video", "audio"];
const capabilityLabel = (capability: Capability) => capability === "audio" ? "modelScripts.tts" : `workspace.${capability}`;

export function ModelDialog({ entry, model, onClose, onSaved }: { entry: ChannelEntry; model?: ServerModel; onClose: () => void; onSaved: () => Promise<void> }) {
    const { t } = useTranslation();
    const { notify } = useFeedback();
    const client = useQueryClient();
    const [rows, setRows] = useState<ModelInput[]>(model ? [model] : []);
    const [selected, setSelected] = useState(model ? 0 : -1);
    const [tab, setTab] = useState("basic");
    const [busy, setBusy] = useState(false);
    const [remote, setRemote] = useState<string[] | null>(null);
    const [remoteFilter, setRemoteFilter] = useState<"all" | "new" | "existing">("all");
    const [remoteSearch, setRemoteSearch] = useState("");
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
    const staged = () => rows.map((row, index) => index === selected ? { ...row, ...form.getValues() } : row);
    const currentRows = staged();
    const existingModelIDs = new Set(entry.models.filter((item) => item.id !== model?.id).map((item) => item.model.trim()));
    const findDuplicate = (items: ModelInput[]) => {
        const seen = new Set(existingModelIDs);
        return items.findIndex((item) => {
            const id = item.model.trim();
            if (!id) return false;
            if (seen.has(id)) return true;
            seen.add(id);
            return false;
        });
    };
    const adapterIDs = [...new Set(currentRows.map((row) => row.adapterId).filter(Boolean))];
    const scriptQueries = useQueries({
        queries: adapterIDs.map((adapterId) => ({ queryKey: ["model-script", adapterId], queryFn: () => getModelScript(adapterId) })),
    });
    const scriptsByAdapter = new Map(adapterIDs.map((adapterId, index) => [adapterId, scriptQueries[index]] as const));
    const source = useWatch({ control: sourceForm.control });
    const bulkType = source.bulkType || "image";
    const dirty = !dequal(staged(), model ? [model] : []) || Boolean(source.manualId || source.manualName || source.remote?.length);
    useEditGuard(dirty, onClose);
    const select = (index: number) => { const next = staged(); setRows(next); setSelected(index); form.reset(next[index]); };
    const append = (models: { model: string; name: string }[]) => {
        const next = staged(), exists = new Set([...entry.models.map((item) => item.model), ...next.map((item) => item.model)]);
        const added = models.filter((item) => { const id = item.model.trim(); if (!id || exists.has(id)) return false; exists.add(id); return true; }).map((item) => ({ ...blankModel(bulkType), model: item.model.trim(), name: item.name.trim(), adapterId: sourceForm.getValues("bulkAdapter") || defaultAdapter(bulkType) }));
        if (!added.length) throw new Error(t("modelScripts.modelsAlreadyAdded"));
        const index = next.length;
        setRows([...next, ...added]);
        setSelected(index);
        form.reset(added[0]);
    };
    const remoteFetch = async () => {
        if (loadingRemote) return;
        const assertSession = captureSession();
        setLoadingRemote(true);
        setRemoteError("");
        try {
            const models = await discoverModels(entry.channel.id);
            assertSession();
            setRemote([...new Set(models)].sort((left, right) => left.localeCompare(right)));
        } catch (failure) {
            setRemoteError(failure instanceof Error ? failure.message : String(failure));
        } finally {
            setLoadingRemote(false);
        }
    };
    const viewScript = async (id: string, task?: { id: string; versionId: string }) => {
        const assertSession = captureSession();
        try {
            const value = await client.fetchQuery({ queryKey: ["model-script", id], queryFn: () => getModelScript(id) });
            assertSession();
            setScriptVersion(task?.versionId ?? (current.adapterId === id ? current.adapterVersionId : ""));
            setScriptTask(task?.id || "");
            setScriptEditor(value.script);
        } catch (failure) {
            notify.error(failure instanceof Error ? failure.message : String(failure));
        }
    };
    const selection = scriptsByAdapter.get(current.adapterId);
    const version = selection?.data?.versions.find((item) => item.id === current.adapterVersionId);
    const selectedReady = selected >= 0 && Boolean(version) && !scripts.error && selection?.isSuccess;
    const rowReady = (row: ModelInput) => {
        const detail = scriptsByAdapter.get(row.adapterId)?.data;
        return Boolean(row.model.trim() && row.name.trim() && detail?.script.capability === row.capability && detail.versions.some((item) => item.id === row.adapterVersionId));
    };
    const batchReady = currentRows.length > 0 && findDuplicate(currentRows) < 0 && !scripts.error && scriptQueries.every((query) => query.isSuccess) && currentRows.every(rowReady);
    const allModelIDs = new Set([...entry.models, ...currentRows].map((item) => item.model.trim()));
    const remoteIDs = remote || [];
    const newRemote = remoteIDs.filter((id) => !allModelIDs.has(id));
    const existingRemote = remoteIDs.filter((id) => allModelIDs.has(id));
    const remoteQuery = remoteSearch.trim().toLowerCase();
    const visibleRemote = remoteIDs.filter((id) => (remoteFilter === "all" || (remoteFilter === "new" ? !allModelIDs.has(id) : allModelIDs.has(id))) && (!remoteQuery || id.toLowerCase().includes(remoteQuery)));
    const selectableRemote = visibleRemote.filter((id) => !allModelIDs.has(id));
    const selectedRemote = source.remote || [];
    const overview = capabilities.map((capability) => ({ capability, count: rows.filter((row) => row.capability === capability).length }));
    const save = async () => {
        const assertSession = captureSession();
        setBusy(true);
        try {
            const prepared = staged();
            const invalid = prepared.findIndex((row) => !row.model.trim() || !row.name.trim() || !row.adapterId);
            if (invalid >= 0) {
                select(invalid);
                throw new Error(t("modelScripts.invalidPending", { model: prepared[invalid].model || invalid + 1 }));
            }
            const duplicate = findDuplicate(prepared);
            if (duplicate >= 0) {
                select(duplicate);
                throw new Error(t("modelScripts.modelsAlreadyAdded"));
            }
            if (!batchReady || !prepared.every(rowReady)) {
                const missing = prepared.findIndex((row) => !rowReady(row));
                if (missing >= 0) select(missing);
                throw new Error(t("modelScripts.versionMissing"));
            }
            if (model) await saveModel(entry.channel.id, model.id, prepared[0]);
            else await saveModels(entry.channel.id, prepared);
            assertSession();
            form.reset(form.getValues());
            onClose();
            notify.success(t("workspace.modelSaved"));
            await onSaved();
        } catch (failure) {
            if (failure instanceof ApiError && /^model_row_\d+$/.test(failure.code)) select(Number(failure.code.slice("model_row_".length)));
            throw failure;
        } finally {
            setBusy(false);
        }
    };
    const addRemote = () => {
        try {
            append((sourceForm.getValues("remote") as string[]).filter((id) => !allModelIDs.has(id)).map((id) => ({ model: id, name: id })));
            sourceForm.setValue("remote", [], { shouldDirty: false });
        } catch (failure) {
            notify.error(failure instanceof Error ? failure.message : String(failure));
        }
    };
    const selectVisibleRemote = () => {
        const selected = new Set(sourceForm.getValues("remote"));
        selectableRemote.forEach((id) => selected.add(id));
        sourceForm.setValue("remote", [...selected], { shouldDirty: true });
    };
    const addManual = () => {
        void sourceForm.handleSubmit((values) => {
            try {
                append([{ model: values.manualId.trim(), name: values.manualName.trim() || values.manualId.trim() }]);
                sourceForm.reset({ ...values, manualId: "", manualName: "" });
            } catch (failure) {
                notify.error(failure instanceof Error ? failure.message : String(failure));
            }
        })().catch((failure: unknown) => notify.error(failure instanceof Error ? failure.message : String(failure)));
    };

    return <><Dialog open={!suspended} title={t(model ? "workspace.editModel" : "workspace.addModel")} description={<>{entry.channel.name}<span role="status" className="ml-2 text-xs">{busy ? t("workspace.saving") : t(dirty ? "workspace.unsaved" : "workspace.allSaved")}</span></>} onClose={onClose} busy={busy} dirty={dirty} width={1040} footer={<>
            <Button type="submit" form="channel-model" loading={busy} disabled={!batchReady || scriptBusy}>{t("common.save")}{!model && rows.length ? ` (${rows.length})` : ""}</Button>
            <Button variant="ghost" disabled={!selectedReady || busy || scriptBusy} onClick={() => setPreview(true)}>{t("modelScripts.previewRequest")}</Button>
            <Button variant="ghost" disabled={!selectedReady || busy || scriptBusy} onClick={() => setTest(true)}>{t("modelScripts.testModel")}</Button>
        </>}>
        {testTask ? <Notice type="info" title={t("modelScripts.testQueued")} action={<Button onClick={() => void viewScript(testTask.adapterId, testTask)}>{t("modelScripts.evidence")}</Button>} /> : null}
        <EditorForm id="channel-model" form={form} onSubmit={save}>
            <Tabs value={tab} onValueChange={setTab} items={[
                {
                    key: "basic",
                    label: t("modelScripts.basic"),
                    children: <div className="space-y-5">
                        {!model ? <FormProvider {...sourceForm}>
                            <div className="space-y-4 rounded-lg border border-border p-4">
                                <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-medium">{t("modelScripts.remoteModels")}</p><p className="mt-1 text-xs text-muted-foreground">{t("modelScripts.remoteHint")}</p></div><Button loading={loadingRemote} onClick={() => void remoteFetch()}>{t("modelScripts.fetchModels")}</Button></div>
                                {remoteError ? <Notice type="error" title={remoteError} action={<Button onClick={() => void remoteFetch()}>{t("workspace.retry")}</Button>} /> : null}
                                {remote !== null ? <div className="space-y-3">
                                    <SearchInput value={remoteSearch} onChange={(event) => setRemoteSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") event.preventDefault(); }} placeholder={t("workspace.searchModels")} aria-label={t("workspace.searchModels")} />
                                    <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                                        <button type="button" className={`rounded-lg border px-3 py-2 text-left ${remoteFilter === "all" ? "border-ring bg-accent" : "border-border"}`} aria-pressed={remoteFilter === "all"} onClick={() => setRemoteFilter("all")}><span className="block text-xs text-muted-foreground">{t("modelScripts.allRemoteModels")}</span><strong className="mt-1 block text-lg font-medium">{remoteIDs.length}</strong></button>
                                        <div className="grid grid-cols-2 gap-2">
                                            <button type="button" className={`rounded-lg border px-3 py-2 text-left ${remoteFilter === "new" ? "border-ring bg-accent" : "border-border"}`} aria-pressed={remoteFilter === "new"} onClick={() => setRemoteFilter("new")}><span className="block text-xs text-muted-foreground">{t("modelScripts.newRemoteModels")}</span><strong className="mt-1 block text-lg font-medium">{newRemote.length}</strong></button>
                                            <button type="button" className={`rounded-lg border px-3 py-2 text-left ${remoteFilter === "existing" ? "border-ring bg-accent" : "border-border"}`} aria-pressed={remoteFilter === "existing"} onClick={() => setRemoteFilter("existing")}><span className="block text-xs text-muted-foreground">{t("modelScripts.existingRemoteModels")}</span><strong className="mt-1 block text-lg font-medium">{existingRemote.length}</strong></button>
                                        </div>
                                        <div className="flex flex-wrap items-center justify-end gap-1">{overview.map((item) => <Badge key={item.capability}>{t(capabilityLabel(item.capability))} {item.count}</Badge>)}</div>
                                    </div>
                                    <Field name="remote" label={t("modelScripts.remoteResults", { count: visibleRemote.length })}>
                                        <Choice multiple searchable options={visibleRemote.map((id) => ({ value: id, label: <span className="flex items-center justify-between gap-2"><span className="break-all">{id}</span><Badge>{t(allModelIDs.has(id) ? "modelScripts.alreadyAdded" : "modelScripts.newModel")}</Badge></span>, disabled: allModelIDs.has(id) }))} />
                                    </Field>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <Button size="sm" variant="ghost" disabled={!selectableRemote.length} onClick={selectVisibleRemote}>{t("ui.selectFiltered")} ({selectableRemote.length})</Button>
                                        <span className="text-xs text-muted-foreground">{t("ui.selectedCount", { count: selectedRemote.length })}</span>
                                        <Button size="sm" className="ml-auto" disabled={!selectedRemote.length} onClick={addRemote}>{t("modelScripts.addSelected")}</Button>
                                    </div>
                                </div> : null}
                                <div className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
                                    <Field name="manualId" label={t("workspace.providerModelId")} schema={z.string().trim().min(1)}><Input /></Field>
                                    <Field name="manualName" label={t("workspace.displayName")}><Input /></Field>
                                    <Button onClick={addManual}>{t("modelScripts.addManual")}</Button>
                                </div>
                                <div className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
                                    <Field name="bulkType" label={t("modelScripts.batchType")}><Choice options={capabilities.map((value) => ({ value, label: t(capabilityLabel(value)) }))} onChange={(capability: Capability) => sourceForm.setValue("bulkAdapter", defaultAdapter(capability), { shouldDirty: false })} /></Field>
                                    <Field name="bulkAdapter" label={t("modelScripts.callAdapter")}><Choice options={scripts.data?.filter((item) => item.capability === bulkType && item.adapterVersionId).map((item) => ({ value: item.id, label: item.name }))} /></Field>
                                    <Button onClick={() => { const adapterId = sourceForm.getValues("bulkAdapter") || defaultAdapter(bulkType); const next = staged().map((row) => ({ ...row, capability: bulkType, adapterId, adapterVersionId: "", parameterOverrides: {} })); setRows(next); if (selected >= 0) form.reset(next[selected]); }}>{t("modelScripts.applyAll")}</Button>
                                </div>
                            </div>
                        </FormProvider> : null}
                        {!model ? <div className="space-y-2">
                            <h3 className="text-sm font-medium">{t("modelScripts.pendingModels")}</h3>
                            {rows.length ? <div className="flex max-h-40 flex-wrap gap-2 overflow-auto">
                                {rows.map((row, index) => <div key={`${row.model}:${index}`} className={`flex items-center gap-1 rounded-md border px-1 ${index === selected ? "border-ring bg-accent" : "border-border"}`}><Button size="sm" variant="ghost" onClick={() => select(index)}>{row.name || row.model}<span className="ml-1 text-xs text-muted-foreground">{t(capabilityLabel(row.capability))}</span></Button><Button size="sm" variant="ghost" aria-label={t("common.delete")} onClick={() => { const next = staged().filter((_, item) => item !== index); setRows(next); const target = next.length ? Math.min(selected, next.length - 1) : -1; setSelected(target); form.reset(target >= 0 ? next[target] : blankModel()); }}>×</Button></div>)}
                            </div> : <p className="text-sm text-muted-foreground">{t("modelScripts.pendingEmpty")}</p>}
                        </div> : null}
                        {selected >= 0 ? <ModelConfigurationFields section="basic" onCreateScript={setCreate} onViewScript={(id) => void viewScript(id)} /> : null}
                    </div>,
                },
                {
                    key: "parameters",
                    label: t("workspace.parameterDefinitions"),
                    disabled: selected < 0,
                    children: selected >= 0 ? <ModelConfigurationFields section="parameters" onCreateScript={setCreate} onViewScript={(id) => void viewScript(id)} /> : null,
                },
                {
                    key: "pricing",
                    label: t("modelScripts.pricing"),
                    disabled: selected < 0,
                    children: selected >= 0 ? <ModelConfigurationFields section="pricing" onCreateScript={setCreate} onViewScript={(id) => void viewScript(id)} /> : null,
                },
            ]} />
        </EditorForm>
        <Dialog title={t("modelScripts.create")} open={Boolean(create)} busy={scriptBusy} onClose={() => setCreate(null)} footer={<Button type="submit" form="model-new-script" loading={scriptBusy}>{t("common.save")}</Button>}>
            {create ? <EditorForm id="model-new-script" initialValues={{ name: current.name || current.model || "", description: "" }} onSubmit={async (values) => {
                const assertSession = captureSession();
                setScriptBusy(true);
                try {
                    const created = await createModelScript({ ...values, capability: create });
                    assertSession();
                    await scripts.refetch();
                    setCreate(null);
                    setScriptVersion("");
                    setScriptTask("");
                    setScriptEditor(created);
                } finally {
                    setScriptBusy(false);
                }
            }}><Field name="name" label={t("workspace.name")} schema={z.string().trim().min(1)}><Input /></Field><Field name="description" label={t("modelScripts.scriptDescription")}><Textarea /></Field></EditorForm> : null}
        </Dialog>
        <Dialog title={scriptEditor?.name || t("modelScripts.title")} open={Boolean(scriptEditor) && !suspended} busy={scriptBusy} width={1100} onClose={() => setScriptEditor(null)} footer={null}>
            {scriptEditor ? <ScriptEditor key={`${scriptEditor.id}:${scriptVersion}:${scriptTask}`} script={scriptEditor} initialVersionId={scriptVersion} initialTaskId={scriptTask} onBusyChange={setScriptBusy} onAssistantOpen={() => setSuspended(true)} modelContext={{ model: current.model, name: current.name, baseUrl: entry.channel.baseUrl }} onPublished={async (published) => {
                await Promise.all([client.invalidateQueries({ queryKey: ["model-scripts"] }), client.invalidateQueries({ queryKey: ["model-script", scriptEditor.id] })]);
                form.setValue("adapterId", scriptEditor.id, { shouldDirty: true });
                form.setValue("adapterVersionId", published.id, { shouldDirty: true });
                form.setValue("parameterOverrides", {}, { shouldDirty: true });
                notify.success(t("modelScripts.selectedForModel"));
            }} /> : null}
        </Dialog>
        {(test || preview) && selection?.data && version ? <ModelScriptTestDialog script={selection.data.script} controls={applyInputOverrides(version.parameters, current.parameterOverrides)} preview={preview ? { files: version.files, baseUrl: entry.channel.baseUrl } : undefined} initial={{ channelId: entry.channel.id, model: form.getValues() }} onClose={() => { setTest(false); setPreview(false); }} onQueued={(id) => setTestTask({ id, adapterId: current.adapterId, versionId: current.adapterVersionId })} /> : null}
    </Dialog>{suspended ? <div className="fixed bottom-4 left-1/2 z-[120] flex -translate-x-1/2 items-center gap-3 rounded-lg border border-border bg-popover px-4 py-3 text-sm shadow-lg"><span>{t("modelScripts.draftRetained")}</span><Button onClick={() => setSuspended(false)}>{t("modelScripts.returnToModel")}</Button></div> : null}</>;
}
