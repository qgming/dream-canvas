import appI18n from "@/i18n";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFeedback } from "@/hooks/use-feedback";
import { Button } from "@/components/ui/button";
import { Disclosure } from "@/components/ui/tabs";
import { Menu } from "@/components/ui/popover";
import { EditorForm, Field, useEditorForm, validateForm } from "@/components/ui/form";
import { z } from "zod";
import { Input, Textarea } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { Choice } from "@/components/ui/choice";
import { Switch } from "@/components/ui/controls";
import { Tooltip } from "@/components/ui/popover";
import type { MenuItem } from "@/components/ui/popover";
import { Check, ChevronDown, CircleAlert, FilePenLine, LoaderCircle, LockKeyhole, MessageSquareText, Plus, RefreshCw, Search, Sparkles, Trash2, Workflow } from "lucide-react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { createAssistantSkill, createAssistantSkillDraft, deleteAssistantSkill, fetchAssistantSkill, setAssistantSkillEnabled, updateAssistantSkill, type AgentSkillDetail, type AgentSkillDraft, type AgentSkillInterface, type AgentSkillScope, type AgentSkillSummary } from "@/services/api/assistant-skills";
import { useAgentSkillStore } from "@/stores/use-agent-skill-store";
import { useAgentStore, type AgentChatItem } from "@/stores/use-agent-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { decodeChannelModel, resolveModelParameters, useConfigStore } from "@/stores/use-config-store";
import { assetId } from "@/services/api/assets";

type ScopeFilter = "all" | AgentSkillScope;
type SkillDraftSource = "conversation" | "canvas";
type SkillEditor = { mode: "create"; values?: SkillFormValues } | { mode: "edit"; detail: AgentSkillDetail };
type SkillFormValues = { name: string; description: string; instructions: string; displayName?: string; shortDescription?: string; defaultPrompt?: string };

const skillNamePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function AgentSkillsView({ clientId }: { clientId: string }) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { notify, confirm } = useFeedback();
    const connected = useAgentStore((state) => state.connected);
    const activeThreadId = useAgentStore((state) => state.activeThreadId);
    const hasConversation = useAgentStore((state) => hasSettledConversation(state.messages, state.activeThreadId));
    const hasCanvas = useAgentStore((state) => Boolean(state.canvasContext));
    const sending = useAgentStore((state) => state.sending);
    const waiting = useAgentStore((state) => state.waiting);
    const setAgentState = useAgentStore((state) => state.setAgentState);
    const skills = useAgentSkillStore((state) => state.skills);
    const selectedSkill = useAgentSkillStore((state) => state.selectedSkill);
    const loading = useAgentSkillStore((state) => state.loading);
    const loaded = useAgentSkillStore((state) => state.loaded);
    const errors = useAgentSkillStore((state) => state.errors);
    const draft = useAgentSkillStore((state) => state.draft);
    const generatingSource = useAgentSkillStore((state) => state.generatingSource);
    const loadSkills = useAgentSkillStore((state) => state.loadSkills);
    const selectSkill = useAgentSkillStore((state) => state.selectSkill);
    const clearSelection = useAgentSkillStore((state) => state.clearSelection);
    const setDraft = useAgentSkillStore((state) => state.setDraft);
    const setGeneratingSource = useAgentSkillStore((state) => state.setGeneratingSource);
    const [query, setQuery] = useState("");
    const [scope, setScope] = useState<ScopeFilter>("all");
    const [editor, setEditor] = useState<SkillEditor | null>(null);
    const [viewing, setViewing] = useState<AgentSkillDetail | null>(null);
    const [saving, setSaving] = useState(false);
    const [advancedOpen, setAdvancedOpen] = useState(false);
    const [createMenuOpen, setCreateMenuOpen] = useState(false);
    const [busySkill, setBusySkill] = useState("");
    const [errorsOpen, setErrorsOpen] = useState(false);
    const confirmRef = useRef<{ destroy: () => void } | null>(null);
    const form = useEditorForm<SkillFormValues>();
    const filteredSkills = useMemo(() => {
        const keyword = query.trim().toLowerCase();
        return skills.filter((skill) => {
            if (scope !== "all" && skill.scope !== scope) return false;
            return !keyword || [skill.name, skill.description, skill.interface?.displayName, skill.interface?.shortDescription, skill.shortDescription].some((value) => value?.toLowerCase().includes(keyword));
        });
    }, [query, scope, skills]);

    const editorValues = editor?.mode === "edit" ? skillFormValues(editor.detail) : editor?.values;

    const refresh = () => loadSkills();
    const connectionIsCurrent = (revision: number) => {
        const agent = useAgentStore.getState();
        const skillsState = useAgentSkillStore.getState();
        return skillsState.connectionRevision === revision && agent.connected;
    };
    useEffect(() => {
        if (draft) setEditor((current) => current || { mode: "create", values: draftFormValues(draft) });
    }, [draft]);
    useEffect(() => {
        if (connected) return;
        confirmRef.current?.destroy();
        confirmRef.current = null;
        setEditor(null);
        setViewing(null);
        setSaving(false);
        setAdvancedOpen(false);
        setCreateMenuOpen(false);
        setBusySkill("");
        setErrorsOpen(false);
        form.reset({});
    }, [connected, form]);
    const useSkill = (skill: AgentSkillSummary) => {
        selectSkill(skill);
        setAgentState({ activeTab: "chat" });
    };
    const generateDraft = async (source: SkillDraftSource) => {
        const agent = useAgentStore.getState();
        if (agent.sending || agent.waiting) return notify.warning(t("agent.skillManager.codexBusy"));
        if (source === "conversation" && !hasSettledConversation(agent.messages, agent.activeThreadId)) return notify.warning(t("agent.skillManager.noConversation"));
        if (source === "canvas" && !agent.canvasContext) return notify.warning(t("agent.skillManager.noCanvas"));
        if (!clientId) return notify.warning(t("agent.skillManager.connecting"));
        const connectionRevision = useAgentSkillStore.getState().connectionRevision;
        setGeneratingSource(source);
        try {
            if (!connectionIsCurrent(connectionRevision)) return;
            const config = useConfigStore.getState().config, model = agent.model || config.textModel, selected = decodeChannelModel(model);
            const entry = config.channels.find((channel) => channel.id === selected?.channelId)?.models.find((entry) => entry.name === selected?.model && entry.capability === "text");
            if (!entry) throw new Error(t("workspace.selectAssistantModel"));
            const parameters = resolveModelParameters(config, model, agent.modelParameters[model]);
            for (const control of entry.parameters) if (control.type === "asset" && parameters[control.key]) { const id = assetId(String(parameters[control.key])); if (!id) throw new Error(t("errors.parameterAssetRequired", { name: control.label })); parameters[control.key] = id; }
            const response = await createAssistantSkillDraft({
                source,
                threadId: agent.activeThreadId,
                projectId: agent.canvasContext?.snapshot.projectId,
                model, parameters,
            });
            if (!connectionIsCurrent(connectionRevision)) return;
            if (!response.data) throw new Error(t("agent.skillManager.noDraft"));
            setDraft(response.data);
            notify.success(t("agent.skillManager.draftCreated"));
        } catch (error) {
            if (connectionIsCurrent(connectionRevision)) notify.error(error instanceof Error ? error.message : t("agent.skillManager.draftFailed"));
        } finally {
            if (connectionIsCurrent(connectionRevision)) setGeneratingSource(null);
        }
    };
    const openEdit = async (skill: AgentSkillSummary) => {
        if (!skill.managed || busySkill || useAgentSkillStore.getState().generatingSource) return;
        const connectionRevision = useAgentSkillStore.getState().connectionRevision;
        setBusySkill(skill.path);
        try {
            const response = await fetchAssistantSkill(skill.name);
            if (!connectionIsCurrent(connectionRevision)) return;
            if (!response.data) throw new Error(t("agent.skillManager.contentMissing"));
            setEditor({ mode: "edit", detail: response.data });
        } catch (error) {
            if (connectionIsCurrent(connectionRevision)) notify.error(error instanceof Error ? error.message : t("agent.skillManager.readFailed"));
        } finally {
            if (connectionIsCurrent(connectionRevision)) setBusySkill("");
        }
    };
    const viewSkill = async (skill: AgentSkillSummary) => {
        if (busySkill) return;
        const connectionRevision = useAgentSkillStore.getState().connectionRevision;
        setBusySkill(skill.path);
        try { const response = await fetchAssistantSkill(skill.name); if (!connectionIsCurrent(connectionRevision)) return; if (!response.data) throw new Error(t("agent.skillManager.contentMissing")); setViewing(response.data); }
        catch (error) { if (connectionIsCurrent(connectionRevision)) notify.error(error instanceof Error ? error.message : t("agent.skillManager.readFailed")); }
        finally { if (connectionIsCurrent(connectionRevision)) setBusySkill(""); }
    };
    const saveSkill = async () => {
        if (!editor) return;
        const connectionRevision = useAgentSkillStore.getState().connectionRevision;
        let values: SkillFormValues;
        try {
            values = await validateForm(form);
        } catch {
            const firstError = Object.keys(form.formState.errors)[0] as keyof SkillFormValues | undefined;
            if (firstError === "shortDescription" || firstError === "defaultPrompt") setAdvancedOpen(true);
            if (firstError) requestAnimationFrame(() => form.setFocus(firstError));
            return;
        }
        if (!connectionIsCurrent(connectionRevision)) return;
        const name = editor.mode === "edit" ? editor.detail.name : values.name.trim();
        const skillInterface = compactInterface(values);
        if (skillInterface?.defaultPrompt && !mentionsSkill(skillInterface.defaultPrompt, name)) {
            form.setError("defaultPrompt", { message: t("agent.skillManager.defaultPromptMention", { name }) });
            setAdvancedOpen(true);
            requestAnimationFrame(() => form.setFocus("defaultPrompt"));
            return;
        }
        setSaving(true);
        try {
            const input = { description: values.description.trim(), instructions: values.instructions.trim(), interface: skillInterface || null };
            if (editor.mode === "create") await createAssistantSkill({ name, ...input });
            else await updateAssistantSkill(name, { ...input, expectedRevision: editor.detail.revision });
            if (!connectionIsCurrent(connectionRevision)) return;
            setDraft(null);
            setEditor(null);
            setAdvancedOpen(false);
            await refresh();
            if (!connectionIsCurrent(connectionRevision)) return;
            notify.success(t(editor.mode === "create" ? "agent.skillManager.created" : "agent.skillManager.updated"));
        } catch (error) {
            if (connectionIsCurrent(connectionRevision)) notify.error(error instanceof Error ? error.message : t("agent.skillManager.saveFailed"));
            throw error;
        } finally {
            if (connectionIsCurrent(connectionRevision)) setSaving(false);
        }
    };
    const confirmDelete = (skill: AgentSkillSummary) => {
        const connectionRevision = useAgentSkillStore.getState().connectionRevision;
        confirmRef.current = confirm({
            title: t("agent.skillManager.deleteTitle", { name: skill.interface?.displayName || skill.name }),
            content: t("agent.skillManager.deleteDescription"),
            confirmText: t("agent.skillManager.delete"),
            destructive: true,
            cancelText: t("common.cancel"),
            onConfirm: async () => {
                if (!connectionIsCurrent(connectionRevision)) return;
                setBusySkill(skill.path);
                try {
                    const response = await fetchAssistantSkill(skill.name);
                    if (!connectionIsCurrent(connectionRevision)) return;
                    if (!response.data) throw new Error(t("agent.skillManager.contentMissing"));
                    await deleteAssistantSkill(skill.name, response.data.revision);
                    if (!connectionIsCurrent(connectionRevision)) return;
                    if (selectedSkill?.name === skill.name && selectedSkill.path === skill.path) clearSelection();
                    await refresh();
                    if (!connectionIsCurrent(connectionRevision)) return;
                    notify.success(t("agent.skillManager.deleted"));
                } catch (error) {
                    if (!connectionIsCurrent(connectionRevision)) return;
                    notify.error(error instanceof Error ? error.message : t("agent.skillManager.deleteFailed"));
                    throw error;
                } finally {
                    if (connectionIsCurrent(connectionRevision)) setBusySkill("");
                }
            },
            onCancel: () => {
                confirmRef.current = null;
            },
        });
    };
    const toggleEnabled = async (skill: AgentSkillSummary, enabled: boolean) => {
        const connectionRevision = useAgentSkillStore.getState().connectionRevision;
        if (!connectionIsCurrent(connectionRevision)) return;
        setBusySkill(skill.path);
        try {
            await setAssistantSkillEnabled(skill, enabled);
            if (!connectionIsCurrent(connectionRevision)) return;
            if (!enabled && selectedSkill?.name === skill.name && selectedSkill.path === skill.path) clearSelection();
            await refresh();
        } catch (error) {
            if (connectionIsCurrent(connectionRevision)) notify.error(error instanceof Error ? error.message : t("agent.skillManager.statusFailed"));
        } finally {
            if (connectionIsCurrent(connectionRevision)) setBusySkill("");
        }
    };
    const assistantBusy = sending || waiting;
    const createMenu: { items: MenuItem[] } = {
        items: [
            {
                key: "conversation",
                onClick: () => void generateDraft("conversation"),
                icon: <MessageSquareText className="size-4" />,
                disabled: assistantBusy || !hasConversation,
                label: (
                    <div className="py-0.5">
                        <div className="text-sm">{t("agent.skillManager.fromConversation")}</div>
                        <div className="mt-0.5 text-xs" style={{ color: theme.node.muted }}>{t(assistantBusy ? "agent.skillManager.availableAfterRun" : hasConversation ? "agent.skillManager.conversationDescription" : activeThreadId ? "agent.skillManager.noCompletedContent" : "agent.skillManager.startConversation")}</div>
                    </div>
                ),
            },
            {
                key: "canvas",
                onClick: () => void generateDraft("canvas"),
                icon: <Workflow className="size-4" />,
                disabled: assistantBusy || !hasCanvas,
                label: (
                    <div className="py-0.5">
                        <div className="text-sm">{t("agent.skillManager.fromCanvas")}</div>
                        <div className="mt-0.5 text-xs" style={{ color: theme.node.muted }}>{t(assistantBusy ? "agent.skillManager.availableAfterRun" : hasCanvas ? "agent.skillManager.canvasDescription" : "agent.skillManager.canvasUnavailable")}</div>
                    </div>
                ),
            },
            { type: "divider" as const },
            {
                key: "manual",
                onClick: () => { setDraft(null); form.reset({}); setEditor({ mode: "create" }); },
                icon: <FilePenLine className="size-4" />,
                label: (
                    <div className="py-0.5">
                        <div className="text-sm">{t("agent.skillManager.blankCreate")}</div>
                        <div className="mt-0.5 text-xs" style={{ color: theme.node.muted }}>{t("agent.skillManager.blankDescription")}</div>
                    </div>
                ),
            },
        ],

    };

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="shrink-0 border-b px-4 py-3" style={{ borderColor: theme.node.stroke }}>
                <div className="flex items-center justify-between gap-3">
                    <div>
                        <div className="text-sm font-semibold">{appI18n.t("workspace.personalSkills")}</div>
                        <div className="mt-0.5 text-xs" style={{ color: theme.node.muted }}>{appI18n.t("workspace.skillsDescription")}</div>
                    </div>
                    <div className="flex items-center gap-1">
                        <Tooltip title={t("agent.skillManager.reload")}>
                            <Button variant="ghost"  className="!h-8 !w-8 !min-w-8" aria-label={t("agent.skillManager.reloadSkill")} disabled={!connected || loading} icon={<RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />} onClick={() => void refresh()} />
                        </Tooltip>
                        <Menu placement="bottomRight" open={createMenuOpen} onOpenChange={setCreateMenuOpen} disabled={!connected || !clientId || Boolean(generatingSource)} items={createMenu.items}>
                            <Button variant="ghost" className="!h-8 !px-2" aria-haspopup="menu" aria-expanded={createMenuOpen} disabled={!connected || !clientId} loading={Boolean(generatingSource)} icon={<Plus className="size-4" />}>
                                {t("agent.skillManager.createSkill")} <ChevronDown className="size-3.5 opacity-60" />
                            </Button>
                        </Menu>
                    </div>
                </div>
                <div className="mt-3 flex gap-2">
                    <Input aria-label={t("agent.skills.search")} className="min-w-0 flex-1" disabled={!connected} value={query} onChange={(event) => setQuery(event.target.value)} prefix={<Search className="size-3.5" />} placeholder={t("agent.skills.search")} />
                    <Choice<ScopeFilter>
                        compact
                        borderless
                        aria-label={t("agent.skillManager.filterBySource")}
                        className="w-28 shrink-0"
                        disabled={!connected}
                        value={scope}
                        onChange={setScope}
                        options={[{ value: "all", label: t("agent.skillManager.scopes.all") }, ...(["repo", "user", "system", "admin"] as AgentSkillScope[]).map((value) => ({ value, label: t(`agent.skillManager.scopes.${value}`) }))]}
                    />
                </div>
                {errors.length ? (
                    <Button variant="ghost" data-destructive size="sm" className="!mt-1 !h-7 !px-1 text-xs" icon={<CircleAlert className="size-3.5" />} onClick={() => setErrorsOpen(true)}>{t("agent.skillManager.loadErrors", { count: errors.length })}</Button>
                ) : null}
            </div>
            <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-4">
                {loading && !loaded ? (
                    <div className="flex h-40 items-center justify-center gap-2 text-sm" style={{ color: theme.node.muted }}><LoaderCircle className="size-4 animate-spin" />{t("agent.skills.loading")}</div>
                ) : filteredSkills.length ? (
                    <div className="divide-y" style={{ borderColor: theme.node.stroke }}>
                        {filteredSkills.map((skill) => {
                            const selected = selectedSkill?.name === skill.name && selectedSkill.path === skill.path;
                            const busy = busySkill === skill.path;
                            return (
                                <div key={`${skill.name}:${skill.path}`} className={`py-3 transition-opacity ${skill.enabled ? "" : "opacity-55"}`} style={{ borderColor: theme.node.stroke }}>
                                    <div className="flex items-start gap-3">
                                        <Sparkles className="mt-0.5 size-4 shrink-0" style={{ color: selected ? theme.node.text : theme.node.muted }} />
                                        <div className="min-w-0 flex-1">
                                            <div className="flex min-w-0 items-center gap-2">
                                                <span className="truncate text-sm font-medium">{skill.interface?.displayName || skill.name}</span>
                                                {!skill.managed ? <Tooltip title={t("agent.skillManager.externalReadonly")}><LockKeyhole className="size-3.5 shrink-0" style={{ color: theme.node.faint }} /></Tooltip> : null}
                                            </div>
                                            <div className="mt-1 line-clamp-2 text-xs leading-5" style={{ color: theme.node.muted }}>{skill.interface?.shortDescription || skill.shortDescription || skill.description || t("agent.skillManager.noDescription")}</div>
                                            <Tooltip title={skill.path}>
                                                <div className="mt-1.5 truncate text-xs" style={{ color: theme.node.faint }}>{t(`agent.skillManager.scopes.${skill.scope}`)} · {skill.name}</div>
                                            </Tooltip>
                                        </div>
                                    </div>
                                    <div className="mt-2 flex items-center justify-between gap-2 pl-7">
                                        <label className="inline-flex items-center gap-2 text-xs" style={{ color: theme.node.muted }}>
                                            <Switch size="small" checked={skill.enabled} loading={busy} disabled={!skill.managed || !connected || Boolean(busySkill) || Boolean(generatingSource)} onChange={(enabled) => void toggleEnabled(skill, enabled)} />
                                            {t(skill.enabled ? "agent.skillManager.enabled" : "agent.skillManager.disabled")}
                                        </label>
                                        <div className="flex items-center gap-0.5">
                                            {!skill.managed ? <Button variant="ghost" size="sm" disabled={!connected || Boolean(busySkill)} onClick={() => void viewSkill(skill)}>{t("common.details")}</Button> : null}
                                            <Button variant="ghost" size="sm" disabled={!connected || !skill.enabled || Boolean(busySkill)} icon={selected ? <Check className="size-3.5" /> : <Sparkles className="size-3.5" />} onClick={() => useSkill(skill)}>{t(selected ? "agent.skillManager.selected" : "agent.skillManager.use")}</Button>
                                            {skill.managed ? (
                                                <>
                                                    <Tooltip title={t("common.edit")}><Button variant="ghost"  size="sm" aria-label={t("agent.skillManager.editNamed", { name: skill.interface?.displayName || skill.name })} disabled={!connected || Boolean(busySkill) || Boolean(generatingSource)} icon={<FilePenLine className="size-3.5" />} onClick={() => void openEdit(skill)} /></Tooltip>
                                                    <Tooltip title={t("common.delete")}><Button variant="ghost" data-destructive  size="sm" aria-label={t("agent.skillManager.deleteNamed", { name: skill.interface?.displayName || skill.name })} disabled={!connected || Boolean(busySkill) || Boolean(generatingSource)} icon={<Trash2 className="size-3.5" />} onClick={() => confirmDelete(skill)} /></Tooltip>
                                                </>
                                            ) : null}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <div className="flex h-48 flex-col items-center justify-center text-center">
                        <Sparkles className="size-5" style={{ color: theme.node.faint }} />
                        <div className="mt-3 text-sm font-medium">{t(!connected ? "agent.skillManager.connectToView" : skills.length ? "agent.skillManager.noMatch" : "agent.skillManager.none")}</div>
                        <div className="mt-1 text-xs" style={{ color: theme.node.muted }}>{t(!connected ? "agent.skillManager.connectDescription" : skills.length ? "agent.skillManager.tryAnotherFilter" : "agent.skillManager.createOrInstall")}</div>
                    </div>
                )}
            </div>

            <Dialog title={viewing?.interface?.displayName || viewing?.name || t("common.details")} open={Boolean(viewing)} footer={null} width={720} onClose={() => setViewing(null)}><pre className="whitespace-pre-wrap break-words text-sm leading-6">{viewing?.instructions}</pre></Dialog>
            <Dialog title={t("agent.skillManager.loadErrors", { count: errors.length })} open={errorsOpen} footer={null} width={720} onClose={() => setErrorsOpen(false)}>
                <div className="thin-scrollbar mt-4 max-h-[60vh] overflow-y-auto rounded-md border px-3 py-2 text-xs leading-5" style={{ borderColor: theme.node.stroke }}>
                    {errors.map((error, index) => <div key={`${index}:${error}`} className="break-all py-1" style={{ color: theme.node.muted }}>{error}</div>)}
                </div>
            </Dialog>

            <Dialog
                title={editor?.mode === "edit" ? t("agent.skillManager.editNamed", { name: editor.detail.interface?.displayName || editor.detail.name }) : t("agent.skillManager.createSkill")}
                open={Boolean(editor)}
                confirmText={t(editor?.mode === "edit" ? "agent.skillManager.saveChanges" : "agent.skillManager.createSkill")}
                cancelText={t("common.cancel")}
                busy={saving}
                width={680}
                
                onClose={() => {
                    if (saving) return;
                    setDraft(null);
                    setEditor(null);
                    setAdvancedOpen(false);
                }}
                onConfirm={saveSkill}
            >
                <div className="mb-5 text-xs" style={{ color: theme.node.muted }}>{appI18n.t("workspace.skillsSaved")}</div>
                <EditorForm key={editor?.mode === "edit" ? editor.detail.revision : `create:${editor?.values?.name || "blank"}`} form={form} initialValues={editorValues}>
                    <div className="mb-3 text-xs font-medium" style={{ color: theme.node.muted }}>{t("agent.skillManager.basicInfo")}</div>
                    <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
                        <Field name="name" label={t("agent.skillManager.identifier")} description={t("agent.skillManager.identifierExtra")} schema={z.string().trim().min(1, t("agent.skillManager.identifierRequired")).max(64, t("agent.skillManager.identifierMax")).regex(skillNamePattern, t("agent.skillManager.identifierPattern"))}>
                            <Input maxLength={64} disabled={editor?.mode === "edit"} placeholder={t("agent.skillManager.identifierPlaceholder")} />
                        </Field>
                        <Field name="displayName" label={t("agent.skillManager.displayName")} schema={z.preprocess((value) => value === "" || value == null ? undefined : value, z.string().max(64, t("agent.skillManager.displayNameMax")).optional())}><Input maxLength={64} placeholder={t("agent.skillManager.displayNamePlaceholder")} /></Field>
                    </div>
                    <Field name="description" label={t("agent.skillManager.whenToUse")} description={t("agent.skillManager.whenToUseExtra")} schema={z.string().trim().min(1, t("agent.skillManager.whenToUseRequired")).max(1024, t("agent.skillManager.whenToUseMax")).refine((value) => !/[<>]/.test(value), t("agent.skillManager.noAngleBrackets"))}><Textarea maxLength={1024} autoSize={{ minRows: 2, maxRows: 4 }} placeholder={t("agent.skillManager.whenToUsePlaceholder")} /></Field>
                    <Field name="instructions" label={t("agent.skillManager.instructions")} description={t("agent.skillManager.instructionsExtra")} schema={z.string().trim().min(1, t("agent.skillManager.instructionsRequired"))}><Textarea className="!leading-6" autoSize={{ minRows: 6, maxRows: 10 }} placeholder={t("agent.skillManager.instructionsPlaceholder")} /></Field>
                    <Disclosure title={t("agent.skillManager.advanced")} open={advancedOpen} onOpenChange={setAdvancedOpen}>
                                    <Field name="shortDescription" label={t("agent.skillManager.shortDescription")} description={t("agent.skillManager.shortDescriptionExtra")} schema={z.preprocess((value) => value === "" || value == null ? undefined : value, z.string().min(25, t("agent.skillManager.shortDescriptionMin")).max(64, t("agent.skillManager.shortDescriptionMax")).optional())}><Input maxLength={64} showCount placeholder={t("agent.skillManager.shortDescriptionPlaceholder")} /></Field>
                                    <Field name="defaultPrompt" label={t("agent.skillManager.defaultPrompt")} description={t("agent.skillManager.defaultPromptExtra")} schema={z.preprocess((value) => value === "" || value == null ? undefined : value, z.string().max(1024, t("agent.skillManager.defaultPromptMax")).optional())}><Textarea maxLength={1024} autoSize={{ minRows: 2, maxRows: 4 }} placeholder={t("agent.skillManager.defaultPromptPlaceholder")} /></Field>
                    </Disclosure>
                </EditorForm>
            </Dialog>
        </div>
    );
}

function skillFormValues(detail: AgentSkillDetail): SkillFormValues {
    return {
        name: detail.name,
        description: detail.description,
        instructions: detail.instructions,
        displayName: detail.interface?.displayName || undefined,
        shortDescription: detail.interface?.shortDescription || undefined,
        defaultPrompt: detail.interface?.defaultPrompt || undefined,
    };
}

function draftFormValues(draft: AgentSkillDraft): SkillFormValues {
    return {
        name: draft.name,
        description: draft.description,
        instructions: draft.instructions,
        displayName: draft.displayName || undefined,
        shortDescription: draft.shortDescription || undefined,
        defaultPrompt: draft.defaultPrompt || undefined,
    };
}

function hasSettledConversation(messages: AgentChatItem[], threadId: string) {
    return Boolean(threadId && messages.some((item) => item.role === "user" && item.threadId === threadId && item.turnId));
}

function compactInterface(values: SkillFormValues): AgentSkillInterface | undefined {
    const skillInterface = {
        displayName: values.displayName?.trim() || undefined,
        shortDescription: values.shortDescription?.trim() || undefined,
        defaultPrompt: values.defaultPrompt?.trim() || undefined,
    };
    return Object.values(skillInterface).some(Boolean) ? skillInterface : undefined;
}

function mentionsSkill(prompt: string, name: string) {
    return new RegExp(`\\$${name}(?![A-Za-z0-9_-]|:[A-Za-z0-9_-])`).test(prompt);
}
