import { useState } from "react";
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
import { listChannels, listModelScripts, saveChannel, type ChannelEntry, type ServerModel } from "@/services/api/channels";
import { captureSession } from "@/services/api/client";
import { useFeedback } from "@/hooks/use-feedback";
import { ModelDialog } from "./components/model-dialog";

export default function ChannelsPage() {
    const { t } = useTranslation();
    const { notify } = useFeedback();
    const client = useQueryClient();
    const query = useQuery({ queryKey: ["admin-channels"], queryFn: listChannels });
    const scripts = useQuery({ queryKey: ["model-scripts"], queryFn: listModelScripts });
    const [editor, setEditor] = useState<{ entry?: ChannelEntry } | null>(null);
    const [modelEditor, setModelEditor] = useState<{ entry: ChannelEntry; model?: ServerModel } | null>(null);
    const [busy, setBusy] = useState(false);
    const [toggling, setToggling] = useState("");
    const form = useEditorForm();
    const refresh = async () => { await Promise.all([client.invalidateQueries({ queryKey: ["admin-channels"] }), client.invalidateQueries({ queryKey: ["model-catalog"] })]); };
    const edit = (entry?: ChannelEntry) => { form.reset(entry ? { name: entry.channel.name, baseUrl: entry.channel.baseUrl, credential: "" } : { name: "", baseUrl: "", credential: "" }); setEditor({ entry }); };
    const toggle = async (entry: ChannelEntry, enabled: boolean) => { const assertSession = captureSession(); setToggling(entry.channel.id); try { await saveChannel(entry.channel.id, { ...entry.channel, enabled }); assertSession(); await refresh(); } catch (failure) { notify.error(failure instanceof Error ? failure.message : String(failure)); } finally { setToggling(""); } };
    return <section className="space-y-6"><PageHeader title={t("workspace.channels")} description={t("modelScripts.channelsHint")} actions={<><Button variant="ghost" icon={<RefreshCw className="size-4" />} loading={query.isFetching} onClick={() => void query.refetch()}>{t("workspace.refresh")}</Button><Button asChild variant="ghost"><Link to="/settings/model-scripts">{t("modelScripts.title")}</Link></Button><Button icon={<Plus className="size-4" />} onClick={() => edit()}>{t("workspace.addChannel")}</Button></>} />
        {query.error ? <Notice type="error" title={query.error.message} action={<Button onClick={() => void query.refetch()}>{t("workspace.retry")}</Button>} /> : null}
        {scripts.error ? <Notice type="error" title={scripts.error.message} action={<Button onClick={() => void scripts.refetch()}>{t("workspace.retry")}</Button>} /> : null}
        {query.isLoading ? <div role="status" className="flex min-h-48 items-center justify-center gap-3 text-sm text-muted-foreground"><Spinner size="small" />{t("workspace.channelLoading")}</div> : null}
        {!query.error && query.data?.length === 0 ? <EmptyState description={t("workspace.channelEmpty")}><Button onClick={() => edit()}>{t("workspace.addChannel")}</Button></EmptyState> : null}
        {query.data?.map((entry) => <section key={entry.channel.id} className="space-y-4 pt-2"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 flex-1"><h2 className="text-base font-medium">{entry.channel.name}</h2><div className="mt-1 flex flex-wrap gap-x-3 text-xs leading-5 text-muted-foreground"><span className="break-all">{entry.channel.baseUrl}</span><span>{t(entry.hasCredential ? "workspace.credentialConfigured" : "workspace.credentialMissing")}</span></div></div><div className="flex items-center gap-2"><Switch size="small" aria-label={t("workspace.enableChannel")} checked={entry.channel.enabled} disabled={Boolean(toggling)} loading={toggling === entry.channel.id} onChange={(enabled) => void toggle(entry, enabled)} /><Button variant="ghost" onClick={() => edit(entry)}>{t("workspace.editChannel")}</Button><Button icon={<Plus className="size-4" />} onClick={() => setModelEditor({ entry })}>{t("workspace.addModel")}</Button></div></div>
            <DataTable<ServerModel> compact rowId="id" rows={entry.models} columns={[{ title: t("workspace.name"), dataIndex: "name" }, { title: t("workspace.modelId"), dataIndex: "model", render: (value) => <span className="break-all text-muted-foreground">{value}</span> }, { title: t("workspace.type"), render: (_, model) => t(model.capability === "audio" ? "modelScripts.tts" : `workspace.${model.capability}`) }, { title: t("modelScripts.callAdapter"), render: (_, model) => <Link className="text-sm hover:underline" to={`/settings/model-scripts/${model.adapterId}?version=${encodeURIComponent(model.adapterVersionId)}`}>{scripts.data?.find((script) => script.id === model.adapterId)?.name || model.adapterId}</Link> }, { title: t("workspace.status"), render: (_, model) => <Badge color={model.enabled ? "success" : undefined}>{t(model.enabled ? "workspace.enabled" : "workspace.disabled")}</Badge> }, { title: t("workspace.actions"), align: "right", render: (_, model) => <Button size="sm" variant="ghost" onClick={() => setModelEditor({ entry, model })}>{t("common.edit")}</Button> }]} />
        </section>)}
        <Dialog title={t(editor?.entry ? "workspace.editChannel" : "workspace.addChannel")} open={Boolean(editor)} busy={busy} onClose={() => setEditor(null)} bodyClassName="@container/settings" footer={<Button type="submit" form="channel-editor" loading={busy}>{t("common.save")}</Button>}>
            <EditorForm id="channel-editor" form={form} className="space-y-0" onSubmit={async (values) => { const assertSession = captureSession(); setBusy(true); try { await saveChannel(editor?.entry?.channel.id, { name: values.name, baseUrl: values.baseUrl, credential: values.credential.trim() || undefined, enabled: editor?.entry?.channel.enabled ?? true, version: editor?.entry?.channel.version || 0 }); assertSession(); form.reset(values); setEditor(null); await refresh(); notify.success(t("workspace.channelSaved")); } finally { setBusy(false); } }}>
                <Field layout="horizontal" name="name" label={t("workspace.channelName")} schema={z.string().trim().min(1)}><Input /></Field>
                <Field layout="horizontal" name="baseUrl" label={t("workspace.httpsEndpoint")} description={t("modelScripts.baseUrlHint")} schema={z.string().trim().url().refine((value) => value.startsWith("https://"), t("workspace.httpsEndpoint"))}><Input placeholder="https://api.example.com/v1" /></Field>
                <Field layout="horizontal" name="credential" label={t("workspace.credential")} description={t(editor?.entry ? "workspace.credentialKeep" : "workspace.credentialServer")} schema={editor?.entry ? z.string().optional() : z.string().trim().min(1)}><PasswordInput autoComplete="new-password" /></Field>
            </EditorForm>
        </Dialog>
        {modelEditor ? <ModelDialog key={`${modelEditor.entry.channel.id}:${modelEditor.model?.id || "new"}`} {...modelEditor} onClose={() => setModelEditor(null)} onSaved={refresh} /> : null}
    </section>;
}
