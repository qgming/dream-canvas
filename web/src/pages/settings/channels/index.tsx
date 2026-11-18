import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Plus, RefreshCw } from "lucide-react";
import { z } from "zod";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Notice, Badge, EmptyState, Spinner } from "@/components/ui/display";
import { DataTable } from "@/components/ui/data-table";
import { Dialog } from "@/components/ui/dialog";
import { EditorForm, Field, useEditorForm } from "@/components/ui/form";
import { Input, PasswordInput } from "@/components/ui/input";
import { Switch } from "@/components/ui/controls";
import { deleteChannel, getChannelForEditing, listChannels, listModelScripts, saveChannel, type ChannelEntry, type ServerModel } from "@/services/api/channels";
import { captureSession } from "@/services/api/client";
import { useFeedback } from "@/hooks/use-feedback";
import { ModelDialog } from "./components/model-dialog";
import { DefaultModelSettings } from "./components/default-model-settings";

export default function ChannelsPage() {
    const { t } = useTranslation();
    const { notify, confirm } = useFeedback();
    const client = useQueryClient();
    const query = useQuery({ queryKey: ["admin-channels"], queryFn: listChannels });
    const scripts = useQuery({ queryKey: ["model-scripts"], queryFn: listModelScripts });
    const [editor, setEditor] = useState<{ entry?: ChannelEntry } | null>(null);
    const [modelEditor, setModelEditor] = useState<{ entry: ChannelEntry; model?: ServerModel } | null>(null);
    const [busy, setBusy] = useState(false);
    const [toggling, setToggling] = useState("");
    const [credentialLoading, setCredentialLoading] = useState(false);
    const [credentialError, setCredentialError] = useState("");
    const [credentialRetry, setCredentialRetry] = useState(0);
    const form = useEditorForm();
    const channelId = editor?.entry?.channel.id;
    useEffect(() => {
        if (!channelId) return;
        let active = true;
        setCredentialLoading(true); setCredentialError("");
        void getChannelForEditing(channelId).then(({ channel, credential }) => {
            if (active) form.reset({ name: channel.name, baseUrl: channel.baseUrl, credential, enabled: channel.enabled, version: channel.version });
        }).catch((failure: unknown) => { if (active) setCredentialError(failure instanceof Error ? failure.message : String(failure)); }).finally(() => { if (active) setCredentialLoading(false); });
        return () => { active = false; };
    }, [channelId, credentialRetry, form]);
    const refresh = async () => { await Promise.all([client.invalidateQueries({ queryKey: ["admin-channels"] }), client.invalidateQueries({ queryKey: ["model-catalog"] })]); };
    const closeEditor = () => { form.reset({ name: "", baseUrl: "", credential: "", enabled: true, version: 0 }); setEditor(null); };
    const edit = (entry?: ChannelEntry) => { form.reset({ name: entry?.channel.name || "", baseUrl: entry?.channel.baseUrl || "", credential: "", enabled: entry?.channel.enabled ?? true, version: entry?.channel.version || 0 }); setCredentialLoading(Boolean(entry)); setCredentialError(""); setEditor({ entry }); };
    const remove = () => {
        if (!editor?.entry || busy) return;
        const entry = editor.entry, assertSession = captureSession();
        confirm({ title: t("workspace.removeChannelTitle", { name: entry.channel.name }), content: t("workspace.removeChannelHint"), confirmText: t("workspace.removeChannel"), destructive: true, onConfirm: async () => {
            assertSession(); setBusy(true);
            try { await deleteChannel(entry.channel.id, form.getValues("version")); assertSession(); closeEditor(); await refresh(); notify.success(t("workspace.channelRemoved")); }
            finally { setBusy(false); }
        } });
    };
    const toggle = async (entry: ChannelEntry, enabled: boolean) => { const assertSession = captureSession(); setToggling(entry.channel.id); try { await saveChannel(entry.channel.id, { ...entry.channel, enabled }); assertSession(); await refresh(); } catch (failure) { notify.error(failure instanceof Error ? failure.message : String(failure)); } finally { setToggling(""); } };
    return <section className="space-y-6"><PageHeader title={t("workspace.channels")} description={t("modelScripts.channelsHint")} actions={<><Button variant="ghost" icon={<RefreshCw className="size-4" />} loading={query.isFetching} onClick={() => void query.refetch()}>{t("workspace.refresh")}</Button><Button asChild variant="ghost"><Link to="/settings/model-scripts">{t("modelScripts.title")}</Link></Button><Button icon={<Plus className="size-4" />} onClick={() => edit()}>{t("workspace.addChannel")}</Button></>} />
        <DefaultModelSettings />
        {query.error ? <Notice type="error" title={query.error.message} action={<Button onClick={() => void query.refetch()}>{t("workspace.retry")}</Button>} /> : null}
        {scripts.error ? <Notice type="error" title={scripts.error.message} action={<Button onClick={() => void scripts.refetch()}>{t("workspace.retry")}</Button>} /> : null}
        {query.isLoading ? <div role="status" className="flex min-h-48 items-center justify-center gap-3 text-sm text-muted-foreground"><Spinner size="small" />{t("workspace.channelLoading")}</div> : null}
        {!query.error && query.data?.length === 0 ? <EmptyState description={t("workspace.channelEmpty")}><Button onClick={() => edit()}>{t("workspace.addChannel")}</Button></EmptyState> : null}
        {query.data?.map((entry) => <section key={entry.channel.id} className="space-y-4 pt-2"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 flex-1"><h2 className="text-base font-medium">{entry.channel.name}</h2><div className="mt-1 flex flex-wrap gap-x-3 text-xs leading-5 text-muted-foreground"><span className="break-all">{entry.channel.baseUrl}</span><span>{t(entry.hasCredential ? "workspace.credentialConfigured" : "workspace.credentialMissing")}</span></div></div><div className="flex items-center gap-2"><Switch size="small" aria-label={t("workspace.enableChannel")} checked={entry.channel.enabled} disabled={Boolean(toggling)} loading={toggling === entry.channel.id} onChange={(enabled) => void toggle(entry, enabled)} /><Button variant="ghost" onClick={() => edit(entry)}>{t("workspace.editChannel")}</Button><Button icon={<Plus className="size-4" />} onClick={() => setModelEditor({ entry })}>{t("workspace.addModel")}</Button></div></div>
            <DataTable<ServerModel> compact rowId="id" rows={entry.models} columns={[{ title: t("workspace.name"), dataIndex: "name" }, { title: t("workspace.modelId"), dataIndex: "model", render: (value) => <span className="break-all text-muted-foreground">{value}</span> }, { title: t("workspace.type"), render: (_, model) => t(model.capability === "audio" ? "modelScripts.tts" : `workspace.${model.capability}`) }, { title: t("modelScripts.callAdapter"), render: (_, model) => <Link className="text-sm hover:underline" to={`/settings/model-scripts/${model.adapterId}?version=${encodeURIComponent(model.adapterVersionId)}`}>{scripts.data?.find((script) => script.id === model.adapterId)?.name || model.adapterId}</Link> }, { title: t("workspace.status"), render: (_, model) => <Badge color={model.enabled ? "success" : undefined}>{t(model.enabled ? "workspace.enabled" : "workspace.disabled")}</Badge> }, { title: t("workspace.actions"), align: "right", render: (_, model) => <Button type="button" size="sm" variant="ghost" aria-label={t("workspace.editModel")} onClick={() => setModelEditor({ entry, model })}>{t("workspace.editModel")}</Button> }]} />
        </section>)}
        <Dialog title={t(editor?.entry ? "workspace.editChannel" : "workspace.addChannel")} open={Boolean(editor)} busy={busy} onClose={closeEditor} bodyClassName="@container/settings" footer={<><Button variant="ghost" className="text-destructive hover:text-destructive" disabled={!editor?.entry || busy || credentialLoading} onClick={remove}>{t("workspace.removeChannel")}</Button><Button type="submit" form="channel-editor" loading={busy} disabled={credentialLoading || Boolean(credentialError)}>{t("common.save")}</Button></>}>
            {credentialLoading ? <div role="status" className="flex items-center gap-2 py-3 text-sm text-muted-foreground"><Spinner size="small" />{t("workspace.channelLoading")}</div> : null}
            {credentialError ? <Notice type="error" title={credentialError} action={<Button onClick={() => setCredentialRetry((value) => value + 1)}>{t("workspace.retry")}</Button>} /> : null}
            <EditorForm id="channel-editor" form={form} disabled={credentialLoading || Boolean(credentialError)} className="space-y-0" onSubmit={async (values) => { const assertSession = captureSession(); setBusy(true); try { const created = !editor?.entry; const saved = await saveChannel(editor?.entry?.channel.id, { name: values.name, baseUrl: values.baseUrl, credential: values.credential.trim(), enabled: values.enabled, version: values.version }); assertSession(); closeEditor(); if (created) setModelEditor({ entry: { ...saved, models: [] } }); await refresh(); notify.success(t("workspace.channelSaved")); } finally { setBusy(false); } }}>
                <Field layout="horizontal" name="name" label={t("workspace.channelName")} schema={z.string().trim().min(1)}><Input /></Field>
                <Field layout="horizontal" name="baseUrl" label={t("workspace.channelUrl")} schema={z.string().trim().url().refine((value) => value.startsWith("https://"), t("workspace.httpsEndpoint"))}><Input placeholder="https://api.example.com/v1" /></Field>
                <Field layout="horizontal" name="credential" label={t("workspace.channelKey")} schema={z.string().trim().min(1)}><PasswordInput autoComplete="new-password" showLabel={t("workspace.showChannelKey")} hideLabel={t("workspace.hideChannelKey")} /></Field>
            </EditorForm>
        </Dialog>
        {modelEditor ? <ModelDialog key={`${modelEditor.entry.channel.id}:${modelEditor.model?.id || "new"}`} {...modelEditor} onClose={() => setModelEditor(null)} onSaved={refresh} /> : null}
    </section>;
}
