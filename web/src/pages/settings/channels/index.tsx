import { useTranslation } from "react-i18next";
import appI18n from "@/i18n";
import { PageHeader } from "@/components/layout/page-header";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Notice as Alert } from "@/components/ui/display";
import { useFeedback } from "@/hooks/use-feedback";
import { Button } from "@/components/ui/button";
import { EmptyState as Empty } from "@/components/ui/display";
import { EditorForm, Field, useEditorForm, useWatch } from "@/components/ui/form";
import { z } from "zod";
import { Input, PasswordInput, Textarea } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { Choice } from "@/components/ui/choice";
import { Spinner as Spin } from "@/components/ui/display";
import { Switch } from "@/components/ui/controls";
import { DataTable } from "@/components/ui/data-table";
import { Badge as Tag } from "@/components/ui/display";
import { Plus, RefreshCw } from "lucide-react";
import { useState } from "react";

import { getInterface, listChannels, saveChannel, saveModel, type ChannelEntry, type ServerModel } from "@/services/api/channels";
import { InterfaceEditor } from "./components/interface-editor";
import { captureSession } from "@/services/api/client";


export default function ChannelsPage() {
    useTranslation();
    const { notify } = useFeedback();

    const protocols = [
        { value: "openai-chat", label: "OpenAI Chat Completions", capability: "text" },
        { value: "openai-responses", label: "OpenAI Responses", capability: "text" },
        { value: "openai-image", label: appI18n.t("workspace.openaiImage"), capability: "image" },
        { value: "seedance", label: appI18n.t("workspace.seedanceVideo"), capability: "video" },
        { value: "minimax-video", label: appI18n.t("workspace.minimaxVideo"), capability: "video" },
        { value: "minimax-audio", label: appI18n.t("workspace.minimaxAudio"), capability: "audio" },
        { value: "custom", label: appI18n.t("workspace.customInterface"), capability: "" },
    ];
    const capabilityLabels = { text: appI18n.t("workspace.text"), image: appI18n.t("workspace.image"), video: appI18n.t("workspace.video"), audio: appI18n.t("workspace.audio") };
    const queryClient = useQueryClient();
    const query = useQuery({ queryKey: ["admin-channels"], queryFn: listChannels });
    const [channelEditor, setChannelEditor] = useState<{ entry?: ChannelEntry } | null>(null);
    const [modelEditor, setModelEditor] = useState<{ channelId: string; model?: ServerModel } | null>(null);
    const [scriptModel, setScriptModel] = useState<ServerModel | null>(null);
    const [busy, setBusy] = useState(false);
    const channelForm = useEditorForm();
    const modelForm = useEditorForm();
    const jsonSchema = (array: boolean) => z.string().superRefine((value, context) => {
        try { const parsed = JSON.parse(value); if (array ? !Array.isArray(parsed) : !parsed || Array.isArray(parsed) || typeof parsed !== "object") context.addIssue({ code: "custom", message: appI18n.t(array ? "ui.arrayRequired" : "ui.objectRequired") }); }
        catch { context.addIssue({ code: "custom", message: appI18n.t("ui.jsonInvalid") }); }
    });
    const capability = useWatch({ name: "capability", control: modelForm.control });
    const refresh = async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: ["admin-channels"] }), queryClient.invalidateQueries({ queryKey: ["model-catalog"] })]); };
    const failure = (error: unknown) => { notify.error(error instanceof Error ? error.message : appI18n.t("workspace.operationFailed")); throw error; };
    const editChannel = (entry?: ChannelEntry) => {
        channelForm.reset({});
        channelForm.reset(entry ? { ...entry.channel, credential: "" } : { name: "", baseUrl: "", enabled: false });
        setChannelEditor({ entry });
    };
    const editModel = (channelId: string, model?: ServerModel) => {
        modelForm.reset({});
        modelForm.reset(model ? { ...model, parameters: JSON.stringify(model.parameters, null, 2), pricing: JSON.stringify(model.pricing, null, 2) } : { capability: "image", protocol: "openai-image", enabled: false, parameters: "[]", pricing: "{}" });
        setModelEditor({ channelId, model });
    };

    if (scriptModel) return <InterfaceEditor key={scriptModel.id} model={query.data?.flatMap((entry) => entry.models).find((model) => model.id === scriptModel.id) || scriptModel} onClose={() => setScriptModel(null)} onPublished={refresh} />;

    return (
        <section className="space-y-6">
            <PageHeader title={<>{appI18n.t("workspace.channels")}</>} description={<>{appI18n.t("workspace.channelsDescription")}</>} actions={<><Button variant="ghost" icon={<RefreshCw className="size-4" />} loading={query.isFetching} onClick={() => void query.refetch()}>{appI18n.t("workspace.refresh")}</Button><Button variant="default" icon={<Plus className="size-4" />} onClick={() => editChannel()}>{appI18n.t("workspace.addChannel")}</Button></>} />
            <Alert type="info" title={appI18n.t("workspace.configurationAvailable")} description={appI18n.t("workspace.executionPending")} />
            {query.error ? <Alert type="error" title={query.error.message} action={<Button onClick={() => void query.refetch()}>{appI18n.t("workspace.retry")}</Button>} /> : null}
            {query.isLoading ? <div role="status" className="flex min-h-48 items-center justify-center gap-3 text-sm text-muted-foreground"><Spin size="small" />{appI18n.t("workspace.channelLoading")}</div> : null}
            {!query.error && query.data?.length === 0 ? <div className="rounded-xl border border-dashed border-border py-12"><Empty description={appI18n.t("workspace.channelEmpty")}><Button variant="default" icon={<Plus className="size-4" />} onClick={() => editChannel()}>{appI18n.t("workspace.addChannel")}</Button></Empty></div> : null}
            {query.data?.map((entry) => <section key={entry.channel.id} className="space-y-4 pt-2">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1 basis-64">
                            <div className="flex flex-wrap items-center gap-2"><h2 className="text-base font-semibold break-words">{entry.channel.name}</h2><Tag color={entry.channel.enabled ? "success" : undefined}>{entry.channel.enabled ? appI18n.t("workspace.enabled") : appI18n.t("workspace.disabled")}</Tag></div>
                            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs leading-5 text-muted-foreground"><span className="break-all">{entry.channel.baseUrl}</span><span>{entry.hasCredential ? appI18n.t("workspace.credentialConfigured") : appI18n.t("workspace.credentialMissing")}</span></div>
                        </div>
                        <div className="ml-auto flex flex-wrap items-center gap-2"><Button variant="ghost" onClick={() => editChannel(entry)}>{appI18n.t("workspace.editChannel")}</Button><Button icon={<Plus className="size-4" />} onClick={() => editModel(entry.channel.id)}>{appI18n.t("workspace.addModel")}</Button></div>
                    </div>
                    <DataTable<ServerModel> rowId="id" compact rows={entry.models} columns={[
                        { title: appI18n.t("workspace.name"), dataIndex: "name", render: (name) => <span className="font-medium break-words">{name}</span> },
                        { title: appI18n.t("workspace.modelId"), dataIndex: "model", render: (model) => <span className="break-all text-muted-foreground">{model}</span> },
                        { title: appI18n.t("workspace.type"), dataIndex: "capability", render: (value: ServerModel["capability"]) => capabilityLabels[value] },
                        { title: appI18n.t("workspace.protocol"), dataIndex: "protocol", render: (value) => protocols.find((item) => item.value === value)?.label || value },
                        { title: appI18n.t("workspace.status"), render: (_, model) => <Tag color={model.enabled ? "success" : undefined}>{model.enabled ? appI18n.t("workspace.enabled") : appI18n.t("workspace.disabled")}</Tag> },
                        { title: appI18n.t("workspace.actions"), align: "right", render: (_, model) => <div className="flex flex-wrap items-center justify-end gap-2"><Button variant="ghost" size="sm" onClick={() => editModel(entry.channel.id, model)}>{appI18n.t("workspace.edit")}</Button>{model.protocol === "custom" ? <Button variant="ghost" size="sm" onClick={() => { void queryClient.prefetchQuery({ queryKey: ["interface", model.id], queryFn: () => getInterface(model.id) }); setScriptModel(model); }}>{appI18n.t("workspace.interfaceScripts")}</Button> : null}</div> },
                    ]} />
            </section>)}
            <Dialog title={channelEditor?.entry ? appI18n.t("workspace.editChannel") : appI18n.t("workspace.addChannel")} open={Boolean(channelEditor)} busy={busy} onClose={() => { channelForm.reset({}); setChannelEditor(null); }} bodyClassName="@container/settings" footer={<Button variant="default" type="submit" form="settings-channel" loading={busy}>{appI18n.t("workspace.saveChannel")}</Button>}>
                <EditorForm id="settings-channel" form={channelForm} className="space-y-0" onSubmit={async (values) => {
                    const assertSession = captureSession();
                    setBusy(true);
                    try {
                        await saveChannel(channelEditor?.entry?.channel.id, { ...values, version: channelEditor?.entry?.channel.version || 0, credential: values.credential?.trim() || undefined });
                        assertSession(); channelForm.reset({}); setChannelEditor(null); await refresh(); assertSession(); notify.success(appI18n.t("workspace.channelSaved"));
                    } catch (error) { failure(error); }
                    finally { setBusy(false); }
                }}>
                    <Field layout="horizontal" name="name" label={appI18n.t("workspace.channelName")} schema={z.string().trim().min(1, appI18n.t("workspace.channelNameRequired"))}><Input /></Field>
                    <Field layout="horizontal" name="baseUrl" label={appI18n.t("workspace.httpsEndpoint")} schema={z.string().trim().min(1, appI18n.t("workspace.endpointRequired")).url(appI18n.t("workspace.endpointRequired")).refine((value) => value.startsWith("https://"), appI18n.t("workspace.httpsEndpoint"))}><Input placeholder="https://api.example.com" /></Field>
                    <Field layout="horizontal" name="credential" label={appI18n.t("workspace.credential")} description={channelEditor?.entry ? appI18n.t("workspace.credentialKeep") : appI18n.t("workspace.credentialServer")} schema={(!channelEditor?.entry ? z.string().trim().min(1, appI18n.t("workspace.credentialRequired")) : z.string().trim().optional())}><PasswordInput autoComplete="new-password" /></Field>
                    <Field layout="horizontal" name="enabled" label={appI18n.t("workspace.enableChannel")} checked><Switch /></Field>
                </EditorForm>
            </Dialog>
            <Dialog title={modelEditor?.model ? appI18n.t("workspace.editModel") : appI18n.t("workspace.addModel")} open={Boolean(modelEditor)} busy={busy} onClose={() => setModelEditor(null)} bodyClassName="@container/settings" footer={<Button variant="default" type="submit" form="settings-model" loading={busy}>{appI18n.t("workspace.saveModel")}</Button>} width={720}>
                <EditorForm id="settings-model" form={modelForm} className="space-y-6" onSubmit={async (values) => {
                    if (!modelEditor) return;
                    const assertSession = captureSession();
                    setBusy(true);
                    try { await saveModel(modelEditor.channelId, modelEditor.model?.id, { ...values, parameters: JSON.parse(values.parameters), pricing: JSON.parse(values.pricing), version: modelEditor.model?.version || 0 }); assertSession(); modelForm.reset(values); setModelEditor(null); await refresh(); assertSession(); notify.success(appI18n.t("workspace.modelSaved")); }
                    catch (error) { failure(error); }
                    finally { setBusy(false); }
                }}>
                    <div>
                        <Field layout="horizontal" name="name" label={appI18n.t("workspace.displayName")} schema={z.string().trim().min(1, appI18n.t("workspace.displayNameRequired"))}><Input /></Field>
                        <Field layout="horizontal" name="model" label={appI18n.t("workspace.providerModelId")} schema={z.string().trim().min(1, appI18n.t("workspace.modelIdRequired"))}><Input /></Field>
                        <Field layout="horizontal" name="capability" label={appI18n.t("workspace.type")}><Choice options={Object.entries(capabilityLabels).map(([value, label]) => ({ value, label }))} onChange={(value) => modelForm.setValue("protocol", protocols.find((protocol) => protocol.capability === value)?.value || "custom", { shouldDirty: true })} /></Field>
                        <Field layout="horizontal" name="protocol" label={appI18n.t("workspace.callProtocol")}><Choice options={protocols.filter((protocol) => !protocol.capability || protocol.capability === capability).map((protocol) => ({ ...protocol, label: protocol.label }))} /></Field>
                        <Field layout="horizontal" name="enabled" label={appI18n.t("workspace.enableModel")} checked><Switch /></Field>
                    </div>
                    <Field name="parameters" schema={jsonSchema(true)} label={appI18n.t("workspace.parameterDefinitions")} description={modelEditor?.model?.protocol === "custom" && modelEditor.model.publishedVersionId ? appI18n.t("workspace.publishedParameters") : appI18n.t("workspace.parameterExample")}><Textarea className="font-mono text-xs" rows={7} spellCheck={false} readOnly={modelEditor?.model?.protocol === "custom" && Boolean(modelEditor.model.publishedVersionId)} /></Field>
                    <Field name="pricing" schema={jsonSchema(false)} label={appI18n.t("workspace.pricingDraft")} description={appI18n.t("workspace.pricingDescription")}><Textarea className="font-mono text-xs" rows={3} spellCheck={false} /></Field>
                </EditorForm>
            </Dialog>

        </section>
    );
}
