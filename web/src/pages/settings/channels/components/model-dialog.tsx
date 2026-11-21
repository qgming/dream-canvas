import { useState } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormProvider } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { dequal } from "dequal";
import { z } from "zod";
import { Tabs } from "@animate-ui/react/primitives/radix-ui";
import { CloudDownload, Eye, FlaskConical, Plus, Save, Settings2, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/display";
import { EditorForm, Field, useEditorForm, useWatch } from "@/components/ui/form";
import { Input, Textarea } from "@/components/ui/input";
import { Choice } from "@/components/ui/choice";
import { Disclosure } from "@/components/ui/tabs";
import { ModelConfigurationFields, blankModel, defaultAdapter } from "@/components/model-configuration-fields";
import { ModelScriptTestDialog } from "@/components/model-script-test-dialog";
import { createModelScript, getModelScript, listModelScripts, saveModel, saveModels, type Capability, type ChannelEntry, type ModelInput, type ModelScript, type ServerModel } from "@/services/api/channels";
import { ScriptEditor } from "@/pages/settings/model-scripts/components/script-editor";
import { useFeedback } from "@/hooks/use-feedback";
import { useEditGuard } from "@/hooks/use-edit-guard";
import { ApiError, captureSession } from "@/services/api/client";
import { applyInputOverrides } from "@/lib/model-inputs";
import { CloudModelDialog } from "./cloud-model-dialog";

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
    const [cloudOpen, setCloudOpen] = useState(false);
    const [bulkOpen, setBulkOpen] = useState(false);
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
    const sourceForm = useEditorForm({ manualId: "", bulkType: "image" as Capability, bulkAdapter: "openai-image" });
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
    const dirty = !dequal(staged(), model ? [model] : []) || Boolean(source.manualId);
    useEditGuard(dirty, onClose);
    const select = (index: number) => { const next = staged(); setRows(next); setSelected(index); form.reset(next[index]); };
    const append = (models: { model: string; name: string }[]) => {
        const next = staged(), exists = new Set([...entry.models, ...next].map((item) => item.model.trim()));
        const adapterId = sourceForm.getValues("bulkAdapter") || defaultAdapter(bulkType);
        const adapterVersionId = scripts.data?.find((item) => item.id === adapterId)?.adapterVersionId || "";
        const added = models.filter((item) => { const id = item.model.trim(); if (!id || exists.has(id)) return false; exists.add(id); return true; }).map((item) => ({ ...blankModel(bulkType), model: item.model.trim(), name: item.name.trim(), adapterId, adapterVersionId }));
        if (!added.length) throw new Error(t("modelScripts.modelsAlreadyAdded"));
        const index = next.length;
        setRows([...next, ...added]);
        setSelected(index);
        setTab("basic");
        form.reset(added[0]);
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
    const addManual = () => {
        void sourceForm.handleSubmit((values) => {
            try {
                append([{ model: values.manualId.trim(), name: values.manualId.trim() }]);
                sourceForm.reset({ ...values, manualId: "" });
            } catch (failure) {
                notify.error(failure instanceof Error ? failure.message : String(failure));
            }
        })().catch((failure: unknown) => notify.error(failure instanceof Error ? failure.message : String(failure)));
    };

    return <><Dialog open={!suspended} title={`${t(model ? "workspace.editModel" : "workspace.addModel")} · ${entry.channel.name}`} headerActions={!model ? <Button icon={<CloudDownload />} disabled={busy || scriptBusy} onClick={() => setCloudOpen(true)}>{t("modelScripts.fetchModels")}</Button> : null} onClose={onClose} busy={busy} dirty={dirty} width={800} bodyClassName="@container/settings" secondaryAction={null} footer={<>
            <Button variant="outline" icon={<Eye />} disabled={!selectedReady || busy || scriptBusy} onClick={() => setPreview(true)}>{t("modelScripts.previewRequest")}</Button>
            <Button variant="outline" icon={<FlaskConical />} disabled={!selectedReady || busy || scriptBusy} onClick={() => setTest(true)}>{t("modelScripts.testModel")}</Button>
            <Button variant="default" icon={<Save />} type="submit" form="channel-model" loading={busy} disabled={!batchReady || scriptBusy}>{t("common.save")}{!model && rows.length ? ` (${rows.length})` : ""}</Button>
        </>}>
        {testTask ? <Notice type="info" title={t("modelScripts.testQueued")} action={<Button onClick={() => void viewScript(testTask.adapterId, testTask)}>{t("modelScripts.evidence")}</Button>} /> : null}
        <EditorForm id="channel-model" form={form} onSubmit={save}>
            <Tabs.Root value={tab} onValueChange={setTab} className="min-w-0">
                <div className="thin-scrollbar mb-3 min-w-0 overflow-x-auto overflow-y-hidden pb-1"><Tabs.List aria-label={t(model ? "workspace.editModel" : "workspace.addModel")} className="inline-flex w-max items-center gap-1 rounded-xl border border-border bg-card p-1">
                    {[{ key: "basic", label: "modelScripts.basic", icon: Settings2 }, { key: "parameters", label: "workspace.parameterDefinitions", icon: SlidersHorizontal }].map(({ key, label, icon: Icon }) => <Tabs.Trigger key={key} value={key} disabled={key === "parameters" && selected < 0} className="inline-flex h-8 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md px-3 text-sm font-medium text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[state=active]:bg-accent data-[state=active]:text-card-foreground data-[state=active]:shadow-sm disabled:pointer-events-none disabled:opacity-50"><Icon className="size-4 text-foreground" />{t(label)}</Tabs.Trigger>)}
                </Tabs.List></div>
                <Tabs.Content value="basic" className="space-y-5 outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        {!model ? <FormProvider {...sourceForm}>
                            <Field layout="horizontal" label={t("modelScripts.addManual")} help={t("modelScripts.manualAddHint")}><div className="flex w-full min-w-0 items-start gap-2"><Field name="manualId" schema={z.string().trim().min(1)} className="min-w-0 flex-1"><Input placeholder={t("workspace.providerModelId")} aria-label={t("workspace.providerModelId")} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addManual(); } }} /></Field><Button icon={<Plus />} onClick={addManual}>{t("modelScripts.addManual")}</Button></div></Field>
                        </FormProvider> : null}
                        {!model ? <Field label={t("modelScripts.pendingModels")} help={t("modelScripts.pendingHint")}>
                            {currentRows.length ? <div className="thin-scrollbar flex max-h-36 flex-wrap gap-2 overflow-y-auto p-0.5">
                                {currentRows.map((row, index) => <div key={index} className={`flex min-w-0 max-w-full items-center gap-1 rounded-lg border px-1 ${index === selected ? "border-foreground/30 bg-accent" : "border-border bg-card"}`}><Button variant="ghost" className={`min-w-0 shrink px-2 ${index === selected ? "bg-accent" : ""}`} title={row.model} aria-pressed={index === selected} onClick={() => select(index)}><span className="truncate">{row.name || row.model}</span></Button><Button size="icon" variant="ghost" className="size-7" title={t("modelScripts.removePending", { model: row.name || row.model })} aria-label={t("modelScripts.removePending", { model: row.name || row.model })} onClick={() => { const next = staged().filter((_, item) => item !== index); setRows(next); const target = next.length ? Math.max(0, Math.min(selected - (index < selected ? 1 : 0), next.length - 1)) : -1; setSelected(target); form.reset(target >= 0 ? next[target] : blankModel()); }}><X /></Button></div>)}
                            </div> : <p className="py-3 text-sm text-muted-foreground">{t("modelScripts.pendingEmpty")}</p>}
                        </Field> : null}
                        {selected >= 0 ? <ModelConfigurationFields section="basic" onCreateScript={setCreate} onViewScript={(id) => void viewScript(id)} /> : null}
                        {!model ? <FormProvider {...sourceForm}><Disclosure title={t("modelScripts.batchSettings")} open={bulkOpen} onOpenChange={setBulkOpen}>
                            <Field name="bulkType" layout="horizontal" label={t("modelScripts.batchType")} help={t("modelScripts.batchHint")}><Choice options={capabilities.map((value) => ({ value, label: t(capabilityLabel(value)) }))} onChange={(capability: Capability) => sourceForm.setValue("bulkAdapter", defaultAdapter(capability), { shouldDirty: false })} /></Field>
                            <Field name="bulkAdapter" layout="horizontal" label={t("modelScripts.callAdapter")} help={scripts.data?.find((item) => item.id === source.bulkAdapter)?.description}><Choice options={scripts.data?.filter((item) => item.capability === bulkType && item.adapterVersionId).map((item) => ({ value: item.id, label: item.name }))} /></Field>
                            <div className="flex justify-end pt-2"><Button disabled={!rows.length} onClick={() => { const adapterId = sourceForm.getValues("bulkAdapter") || defaultAdapter(bulkType); const next = staged().map((row) => ({ ...row, capability: bulkType, adapterId, adapterVersionId: scripts.data?.find((item) => item.id === adapterId)?.adapterVersionId || "", parameterOverrides: {} })); setRows(next); if (selected >= 0) form.reset(next[selected]); }}>{t("modelScripts.applyAll")}</Button></div>
                        </Disclosure></FormProvider> : null}
                </Tabs.Content>
                <Tabs.Content value="parameters" className="outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    {selected >= 0 ? <ModelConfigurationFields section="parameters" onCreateScript={setCreate} onViewScript={(id) => void viewScript(id)} /> : null}
                </Tabs.Content>
            </Tabs.Root>
        </EditorForm>
        {!model ? <CloudModelDialog open={cloudOpen} channelId={entry.channel.id} existing={existingModelIDs} pending={new Set(currentRows.map((row) => row.model.trim()))} onClose={() => setCloudOpen(false)} onSelect={(ids) => append(ids.map((id) => ({ model: id, name: id })))} /> : null}
        <Dialog title={t("modelScripts.create")} open={Boolean(create)} busy={scriptBusy} bodyClassName="@container/settings" onClose={() => setCreate(null)} footer={<Button type="submit" form="model-new-script" loading={scriptBusy}>{t("common.save")}</Button>}>
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
            }} className="space-y-0"><Field name="name" layout="horizontal" label={t("workspace.name")} schema={z.string().trim().min(1)}><Input /></Field><Field name="description" layout="horizontal" label={t("modelScripts.scriptDescription")}><Textarea /></Field></EditorForm> : null}
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
