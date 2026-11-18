import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Collapsible } from "@animate-ui/react/primitives/radix-ui";
import { Reorder, useDragControls } from "motion/react";
import { useMotionTokens, useShouldReduceMotion } from "@animate-ui/react/utils/motion";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ChevronDown, GripVertical, Plus, RefreshCw } from "lucide-react";
import { z } from "zod";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Badge, EmptyState, Notice, Spinner } from "@/components/ui/display";
import { Dialog } from "@/components/ui/dialog";
import { EditorForm, Field, useEditorForm } from "@/components/ui/form";
import { Input, PasswordInput, SearchInput } from "@/components/ui/input";
import { Choice } from "@/components/ui/choice";
import { Switch } from "@/components/ui/controls";
import { deleteChannel, getChannelForEditing, listChannels, listModelScripts, saveChannel, saveModel, type Capability, type ChannelEntry, type ModelScript, type ServerModel } from "@/services/api/channels";
import { captureSession } from "@/services/api/client";
import { useFeedback } from "@/hooks/use-feedback";
import { ModelDialog } from "./components/model-dialog";
import { ModelOrderingSettings } from "./components/model-ordering-settings";
import { OrderButtons } from "./components/order-buttons";
import { moveBy, reorderVisible, sortByOrder, useModelOrdering } from "./use-model-ordering";

const capabilityLabel = (capability: Capability) => capability === "audio" ? "modelScripts.tts" : `workspace.${capability}`;

function ModelRow({ model, scripts, index, count, orderDisabled, onToggle, onEdit, onOrderStart, onOrderEnd, onMove }: {
    model: ServerModel;
    scripts?: ModelScript[];
    index: number;
    count: number;
    orderDisabled: boolean;
    onToggle: (model: ServerModel, enabled: boolean) => Promise<void>;
    onEdit: () => void;
    onOrderStart: () => void;
    onOrderEnd: () => void;
    onMove: (index: number) => void;
}) {
    const { t } = useTranslation();
    const controls = useDragControls();
    const tokens = useMotionTokens();
    const reducedMotion = useShouldReduceMotion();
    const [enabled, setEnabled] = useState(model.enabled);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    useEffect(() => setEnabled(model.enabled), [model.enabled]);
    const toggle = async (next: boolean) => {
        if (busy) return;
        setEnabled(next);
        setBusy(true);
        setError("");
        try {
            await onToggle(model, next);
        } catch (failure) {
            setEnabled(model.enabled);
            setError(failure instanceof Error ? failure.message : String(failure));
        } finally {
            setBusy(false);
        }
    };
    const script = scripts?.find((item) => item.id === model.adapterId);
    const dragLabel = t("modelOrdering.dragModel", { name: model.name || model.model });
    return <Reorder.Item value={model.id} tabIndex={-1} drag={orderDisabled ? false : "y"} dragListener={false} dragControls={controls} transition={reducedMotion ? tokens.transition.instant : tokens.spring.reflow} onKeyDown={(event) => { if (event.target === event.currentTarget) event.preventDefault(); }} onDragStart={orderDisabled ? undefined : onOrderStart} onDragEnd={orderDisabled ? undefined : onOrderEnd} className="border-b border-border last:border-b-0">
        <div className="flex min-w-0 items-center gap-2 px-2 py-2">
            <Button type="button" tabIndex={-1} variant="ghost" size="icon" className="size-7 touch-none text-muted-foreground enabled:cursor-grab enabled:active:cursor-grabbing" disabled={orderDisabled} aria-label={dragLabel} onPointerDown={(event) => { if (!orderDisabled) controls.start(event); }}>
                <GripVertical />
            </Button>
            <OrderButtons label={dragLabel} index={index} count={count} disabled={orderDisabled} onMove={onMove} />
            <div className="min-w-0 flex-1">
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="break-words text-sm font-medium">{model.name || model.model}</span>
                    <Badge>{t(capabilityLabel(model.capability))}</Badge>
                    <Badge color={enabled ? "success" : undefined}>{t(enabled ? "workspace.enabled" : "workspace.disabled")}</Badge>
                </div>
                <p className="mt-0.5 break-all text-xs text-muted-foreground">{model.model}</p>
                <p className="mt-0.5 break-words text-xs text-muted-foreground"><Link className="hover:text-foreground hover:underline" to={`/settings/model-scripts/${model.adapterId}?version=${encodeURIComponent(model.adapterVersionId)}`}>{script?.name || model.adapterId}</Link></p>
                {error ? <p role="alert" className="mt-1 text-xs text-destructive">{error}</p> : null}
            </div>
            <Switch size="small" checked={enabled} loading={busy} disabled={busy} aria-label={t("workspace.enableModel")} onChange={(value) => void toggle(value)} />
            <Button size="sm" variant="ghost" onClick={onEdit}>{t("workspace.editModel")}</Button>
        </div>
    </Reorder.Item>;
}

function ChannelModels({ entry, orderIDs, scripts, orderDisabled, onOrderPreview, onOrderEnd, onReorder, onRefresh, onEdit }: {
    entry: ChannelEntry;
    orderIDs: string[];
    scripts?: ModelScript[];
    orderDisabled: boolean;
    onOrderPreview: (ids: string[]) => void;
    onOrderEnd: () => void;
    onReorder: (ids: string[]) => void;
    onRefresh: () => Promise<void>;
    onEdit: (model: ServerModel) => void;
}) {
    const { t } = useTranslation();
    const [search, setSearch] = useState("");
    const [capability, setCapability] = useState<Capability | "">("");
    const [status, setStatus] = useState<"enabled" | "disabled" | "">("");
    const sorted = sortByOrder(entry.models, (model) => model.id, orderIDs);
    const visible = sorted.filter((model) => {
        const query = search.trim().toLowerCase();
        return (!query || model.model.toLowerCase().includes(query) || model.name.toLowerCase().includes(query)) &&
            (!capability || model.capability === capability) &&
            (!status || (status === "enabled" ? model.enabled : !model.enabled));
    });
    const toggle = async (model: ServerModel, enabled: boolean) => {
        const assertSession = captureSession();
        await saveModel(entry.channel.id, model.id, { ...model, enabled });
        assertSession();
        await onRefresh();
    };
    const sortedIDs = sorted.map((model) => model.id);
    const visibleIDs = visible.map((model) => model.id);
    const preview = (nextVisible: string[]) => onOrderPreview(reorderVisible(sortedIDs, visibleIDs, nextVisible));
    const move = (index: number, nextIndex: number) => onReorder(reorderVisible(sortedIDs, visibleIDs, moveBy(visibleIDs, index, nextIndex)));
    return <div className="border-t border-border pt-3">
        <div className="grid gap-2 pb-3 md:grid-cols-[minmax(0,1fr)_10rem_9rem]">
            <SearchInput value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("workspace.searchModels")} aria-label={t("workspace.searchModels")} />
            <Choice value={capability} clearable options={(["text", "image", "video", "audio"] as Capability[]).map((value) => ({ value, label: t(capabilityLabel(value)) }))} onChange={(value) => setCapability(value || "")} placeholder={t("workspace.allCapabilities")} aria-label={t("workspace.allCapabilities")} />
            <Choice value={status} clearable options={[{ value: "enabled", label: t("workspace.enabled") }, { value: "disabled", label: t("workspace.disabled") }]} onChange={(value) => setStatus(value || "")} placeholder={t("workspace.allStatuses")} aria-label={t("workspace.allStatuses")} />
        </div>
        {visible.length ? <Reorder.Group axis="y" values={visibleIDs} onReorder={preview} className="overflow-hidden rounded-lg border border-border">
            {visible.map((model, index) => <ModelRow key={model.id} model={model} scripts={scripts} index={index} count={visible.length} orderDisabled={orderDisabled} onToggle={toggle} onEdit={() => onEdit(model)} onOrderStart={() => onOrderPreview(sortedIDs)} onOrderEnd={onOrderEnd} onMove={(nextIndex) => move(index, nextIndex)} />)}
        </Reorder.Group> : <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">{entry.models.length ? t("workspace.noMatchingModels") : t("modelOrdering.noModels")}</p>}
    </div>;
}

function ChannelCard({ entry, index, count, expanded, modelOrder, scripts, orderDisabled, onToggleExpanded, onEditChannel, onAddModel, onEditModel, onToggleChannel, onOrderStart, onOrderEnd, onMove, onModelOrderPreview, onModelOrderEnd, onModelReorder, onRefresh }: {
    entry: ChannelEntry;
    index: number;
    count: number;
    expanded: boolean;
    modelOrder: string[];
    scripts?: ModelScript[];
    orderDisabled: boolean;
    onToggleExpanded: () => void;
    onEditChannel: () => void;
    onAddModel: () => void;
    onEditModel: (model: ServerModel) => void;
    onToggleChannel: (enabled: boolean) => Promise<void>;
    onOrderStart: () => void;
    onOrderEnd: () => void;
    onMove: (index: number) => void;
    onModelOrderPreview: (ids: string[]) => void;
    onModelOrderEnd: () => void;
    onModelReorder: (ids: string[]) => void;
    onRefresh: () => Promise<void>;
}) {
    const { t } = useTranslation();
    const controls = useDragControls();
    const tokens = useMotionTokens();
    const reducedMotion = useShouldReduceMotion();
    const [enabled, setEnabled] = useState(entry.channel.enabled);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    useEffect(() => setEnabled(entry.channel.enabled), [entry.channel.enabled]);
    const toggle = async (next: boolean) => {
        if (busy) return;
        setEnabled(next);
        setBusy(true);
        setError("");
        try {
            await onToggleChannel(next);
        } catch (failure) {
            setEnabled(entry.channel.enabled);
            setError(failure instanceof Error ? failure.message : String(failure));
        } finally {
            setBusy(false);
        }
    };
    const dragLabel = t("modelOrdering.dragChannel", { name: entry.channel.name });
    return <Reorder.Item value={entry.channel.id} tabIndex={-1} drag={orderDisabled ? false : "y"} dragListener={false} dragControls={controls} transition={reducedMotion ? tokens.transition.instant : tokens.spring.reflow} onKeyDown={(event) => { if (event.target === event.currentTarget) event.preventDefault(); }} onDragStart={orderDisabled ? undefined : onOrderStart} onDragEnd={orderDisabled ? undefined : onOrderEnd} className="overflow-hidden rounded-lg border border-border bg-card">
        <Collapsible.Root open={expanded} onOpenChange={(open) => { if (open !== expanded) onToggleExpanded(); }}>
            <div className="flex min-w-0 items-start gap-2 p-3">
                <Button type="button" tabIndex={-1} variant="ghost" size="icon" className="mt-0.5 size-7 touch-none text-muted-foreground enabled:cursor-grab enabled:active:cursor-grabbing" disabled={orderDisabled} aria-label={dragLabel} onPointerDown={(event) => { if (!orderDisabled) controls.start(event); }}>
                    <GripVertical />
                </Button>
                <OrderButtons label={dragLabel} index={index} count={count} disabled={orderDisabled} onMove={onMove} />
                <Collapsible.Trigger asChild>
                    <button type="button" className="min-w-0 flex-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        <span className="flex min-w-0 items-start gap-2"><span className="break-words text-sm font-medium">{entry.channel.name}</span><ChevronDown className={`mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`} /></span>
                        <span className="mt-1 block break-all text-xs leading-5 text-muted-foreground">{entry.channel.baseUrl}</span>
                        <span className="mt-2 flex flex-wrap items-center gap-2"><Badge color={entry.hasCredential ? "success" : "error"}>{t(entry.hasCredential ? "workspace.credentialConfigured" : "workspace.credentialMissing")}</Badge><Badge>{t("workspace.modelCount", { count: entry.models.length })}</Badge><Badge color={enabled ? "success" : undefined}>{t(enabled ? "workspace.enabled" : "workspace.disabled")}</Badge></span>
                    </button>
                </Collapsible.Trigger>
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                    <Switch size="small" checked={enabled} loading={busy} disabled={busy} aria-label={t("workspace.enableChannel")} onChange={(value) => void toggle(value)} />
                    <Button size="sm" variant="ghost" onClick={onEditChannel}>{t("workspace.editChannel")}</Button>
                    <Button size="sm" variant="ghost" icon={<Plus />} onClick={onAddModel}>{t("workspace.addModel")}</Button>
                </div>
            </div>
            {error ? <p role="alert" className="border-t border-border px-3 py-2 text-xs text-destructive">{error}</p> : null}
            <Collapsible.Content><div className="px-3 pb-3"><ChannelModels entry={entry} orderIDs={modelOrder} scripts={scripts} orderDisabled={orderDisabled} onOrderPreview={onModelOrderPreview} onOrderEnd={onModelOrderEnd} onReorder={onModelReorder} onRefresh={onRefresh} onEdit={onEditModel} /></div></Collapsible.Content>
        </Collapsible.Root>
    </Reorder.Item>;
}

export default function ChannelsPage() {
    const { t } = useTranslation();
    const { notify, confirm } = useFeedback();
    const client = useQueryClient();
    const query = useQuery({ queryKey: ["admin-channels"], queryFn: listChannels });
    const scripts = useQuery({ queryKey: ["model-scripts"], queryFn: listModelScripts });
    const ordering = useModelOrdering();
    const [editor, setEditor] = useState<{ entry?: ChannelEntry } | null>(null);
    const [modelEditor, setModelEditor] = useState<{ entry: ChannelEntry; model?: ServerModel } | null>(null);
    const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
    const [busy, setBusy] = useState(false);
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

    const refresh = async () => {
        await Promise.all([
            client.invalidateQueries({ queryKey: ["admin-channels"] }),
            client.invalidateQueries({ queryKey: ["model-catalog"] }),
        ]);
        await ordering.refresh();
    };
    const toggleExpanded = (id: string) => setExpanded((current) => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
    });
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
    const toggleChannel = async (entry: ChannelEntry, enabled: boolean) => {
        const assertSession = captureSession();
        await saveChannel(entry.channel.id, { ...entry.channel, enabled });
        assertSession();
        await refresh();
    };
    const channels = sortByOrder(query.data || [], (entry) => entry.channel.id, ordering.orders.channels);
    const orderDisabled = ordering.busy || ordering.loading || Boolean(ordering.queryError);

    return <section className="space-y-6">
        <PageHeader title={t("workspace.channels")} description={t("modelScripts.channelsHint")} actions={<><Button variant="ghost" icon={<RefreshCw className="size-4" />} loading={query.isFetching} onClick={() => void refresh().catch((failure: unknown) => notify.error(failure instanceof Error ? failure.message : String(failure)))}>{t("workspace.refresh")}</Button><Button asChild variant="ghost"><Link to="/settings/model-scripts">{t("modelScripts.title")}</Link></Button><Button icon={<Plus className="size-4" />} onClick={() => edit()}>{t("workspace.addChannel")}</Button></>} />
        {query.error ? <Notice type="error" title={query.error.message} action={<Button onClick={() => void query.refetch()}>{t("workspace.retry")}</Button>} /> : null}
        {scripts.error ? <Notice type="error" title={scripts.error.message} action={<Button onClick={() => void scripts.refetch()}>{t("workspace.retry")}</Button>} /> : null}
        {query.data ? <ModelOrderingSettings channels={query.data} orders={ordering.orders} loading={ordering.loading} queryError={ordering.queryError} busy={ordering.busy} error={ordering.error} conflict={ordering.conflict} onPreview={ordering.preview} onCommit={ordering.commit} onReorder={ordering.reorder} onRetry={() => void ordering.retry()} onReload={() => void ordering.reload()} /> : null}
        {query.isLoading ? <div role="status" className="flex min-h-48 items-center justify-center gap-3 text-sm text-muted-foreground"><Spinner size="small" />{t("workspace.channelLoading")}</div> : null}
        {!query.error && query.data?.length === 0 ? <EmptyState description={t("workspace.channelEmpty")}><Button onClick={() => edit()}>{t("workspace.addChannel")}</Button></EmptyState> : null}
        {channels.length ? <Reorder.Group axis="y" values={channels.map((entry) => entry.channel.id)} onReorder={(ids) => ordering.preview("channels", ids)} className="space-y-3">
            {channels.map((entry, index) => <ChannelCard key={entry.channel.id} entry={entry} index={index} count={channels.length} expanded={expanded.has(entry.channel.id)} modelOrder={ordering.orders[`channel:${entry.channel.id}`]} scripts={scripts.data} orderDisabled={orderDisabled} onToggleExpanded={() => toggleExpanded(entry.channel.id)} onEditChannel={() => edit(entry)} onAddModel={() => setModelEditor({ entry })} onEditModel={(model) => setModelEditor({ entry, model })} onToggleChannel={(enabled) => toggleChannel(entry, enabled)} onOrderStart={() => ordering.preview("channels", channels.map((item) => item.channel.id))} onOrderEnd={() => ordering.commit("channels")} onMove={(nextIndex) => ordering.reorder("channels", moveBy(channels.map((item) => item.channel.id), index, nextIndex))} onModelOrderPreview={(ids) => ordering.preview(`channel:${entry.channel.id}`, ids)} onModelOrderEnd={() => ordering.commit(`channel:${entry.channel.id}`)} onModelReorder={(ids) => ordering.reorder(`channel:${entry.channel.id}`, ids)} onRefresh={refresh} />)}
        </Reorder.Group> : null}
        <Dialog title={t(editor?.entry ? "workspace.editChannel" : "workspace.addChannel")} open={Boolean(editor)} busy={busy} onClose={closeEditor} bodyClassName="@container/settings" footer={<><Button variant="ghost" className="text-destructive hover:text-destructive" disabled={!editor?.entry || busy || credentialLoading} onClick={remove}>{t("workspace.removeChannel")}</Button><Button type="submit" form="channel-editor" loading={busy} disabled={credentialLoading || Boolean(credentialError)}>{t("common.save")}</Button></>}>
            {credentialLoading ? <div role="status" className="flex items-center gap-2 py-3 text-sm text-muted-foreground"><Spinner size="small" />{t("workspace.channelLoading")}</div> : null}
            {credentialError ? <Notice type="error" title={credentialError} action={<Button onClick={() => setCredentialRetry((value) => value + 1)}>{t("workspace.retry")}</Button>} /> : null}
            <EditorForm id="channel-editor" form={form} disabled={credentialLoading || Boolean(credentialError)} className="space-y-0" onSubmit={async (values) => {
                const assertSession = captureSession();
                setBusy(true);
                try { const created = !editor?.entry; const saved = await saveChannel(editor?.entry?.channel.id, { name: values.name, baseUrl: values.baseUrl, credential: values.credential.trim(), enabled: values.enabled, version: values.version }); assertSession(); closeEditor(); if (created) { setExpanded((current) => new Set(current).add(saved.channel.id)); setModelEditor({ entry: { ...saved, models: [] } }); } await refresh(); notify.success(t("workspace.channelSaved")); }
                finally { setBusy(false); }
            }}>
                <Field layout="horizontal" name="name" label={t("workspace.channelName")} schema={z.string().trim().min(1)}><Input /></Field>
                <Field layout="horizontal" name="baseUrl" label={t("workspace.channelUrl")} schema={z.string().trim().url().refine((value) => value.startsWith("https://"), t("workspace.httpsEndpoint"))}><Input placeholder="https://api.example.com/v1" /></Field>
                <Field layout="horizontal" name="credential" label={t("workspace.channelKey")} schema={z.string().trim().min(1)}><PasswordInput autoComplete="new-password" showLabel={t("workspace.showChannelKey")} hideLabel={t("workspace.hideChannelKey")} /></Field>
            </EditorForm>
        </Dialog>
        {modelEditor ? <ModelDialog key={`${modelEditor.entry.channel.id}:${modelEditor.model?.id || "new"}`} {...modelEditor} onClose={() => setModelEditor(null)} onSaved={refresh} /> : null}
    </section>;
}
