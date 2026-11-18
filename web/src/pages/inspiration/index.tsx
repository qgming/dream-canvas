import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Tabs } from "@animate-ui/react/primitives/radix-ui";
import { useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Check, ChevronDown, Ellipsis, FilePenLine, FileText, Image, LayoutGrid, MessageSquareText, Plus, RefreshCw, Search, Sparkles, Trash2, Video, Workflow } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Choice } from "@/components/ui/choice";
import { Switch } from "@/components/ui/controls";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState, Notice, Spinner } from "@/components/ui/display";
import { Input } from "@/components/ui/input";
import { Menu, type MenuItem } from "@/components/ui/popover";
import { PromptCard } from "@/components/prompts/prompt-card";
import { PromptDetailDialog } from "@/components/prompts/prompt-detail-dialog";
import { usePromptList } from "@/components/prompts/use-prompt-list";
import { useCopyText } from "@/hooks/use-copy-text";
import { useFeedback } from "@/hooks/use-feedback";
import { assetId } from "@/services/api/assets";
import { createAssistantSkillDraft, deleteAssistantSkill, fetchAssistantSkill, setAssistantSkillEnabled, type AgentSkillDetail, type AgentSkillSummary } from "@/services/api/assistant-skills";
import { captureSession } from "@/services/api/client";
import { ALL_PROMPTS_OPTION, deletePrompt, fetchPrompt, type Prompt, type PromptScope, type PromptType } from "@/services/api/prompts";
import { useAgentSkillStore } from "@/stores/use-agent-skill-store";
import { useAgentStore, type AgentChatItem } from "@/stores/use-agent-store";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { decodeChannelModel, resolveModelParameters, useConfigStore } from "@/stores/use-config-store";
import { PromptEditorDialog } from "./components/prompt-editor-dialog";
import { SkillEditorDialog, type SkillEditor } from "./components/skill-editor-dialog";

type InspirationKind = "all" | PromptType | "skills";
type DraftSource = "conversation" | "canvas";
const kinds = [{ key: "all", icon: LayoutGrid }, { key: "text", icon: FileText }, { key: "image", icon: Image }, { key: "video", icon: Video }, { key: "skills", icon: Sparkles }] as const;

export default function InspirationPage() {
    const { t, i18n } = useTranslation();
    const { notify, confirm } = useFeedback();
    const copyText = useCopyText();
    const queryClient = useQueryClient();
    const [searchParams, setSearchParams] = useSearchParams();
    const kind = kinds.some((entry) => entry.key === searchParams.get("kind")) ? searchParams.get("kind") as InspirationKind : "all";
    const [keyword, setKeyword] = useState("");
    const [scope, setScope] = useState<PromptScope>("all");
    const [category, setCategory] = useState(ALL_PROMPTS_OPTION);
    const [promptDetail, setPromptDetail] = useState<Prompt | null>(null);
    const [promptEditor, setPromptEditor] = useState<{ prompt: Prompt | null } | null>(null);
    const [skillDetail, setSkillDetail] = useState<AgentSkillDetail | null>(null);
    const [skillEditor, setSkillEditor] = useState<SkillEditor | null>(null);
    const [busy, setBusy] = useState("");
    const [draftSource, setDraftSource] = useState<DraftSource | null>(null);
    const [sourceProjectId, setSourceProjectId] = useState("");
    const busyRef = useRef(false);
    const skills = useAgentSkillStore((state) => state.skills);
    const selectedSkill = useAgentSkillStore((state) => state.selectedSkill);
    const skillsLoading = useAgentSkillStore((state) => state.loading);
    const skillsLoaded = useAgentSkillStore((state) => state.loaded);
    const skillsErrors = useAgentSkillStore((state) => state.errors);
    const loadSkills = useAgentSkillStore((state) => state.loadSkills);
    const draft = useAgentSkillStore((state) => state.draft);
    const generatingSource = useAgentSkillStore((state) => state.generatingSource);
    const sending = useAgentStore((state) => state.sending);
    const waiting = useAgentStore((state) => state.waiting);
    const hasConversation = useAgentStore((state) => hasSettledConversation(state.messages, state.activeThreadId));
    const projects = useCanvasStore((state) => state.projects);
    const projectsError = useCanvasStore((state) => state.error);
    const showSkills = kind === "all" || kind === "skills";
    const showPrompts = kind !== "skills";
    const prompts = usePromptList({ keyword, category, scope, type: kind === "skills" ? "all" : kind, enabled: showPrompts });
    const filteredSkills = useMemo(() => {
        const search = keyword.trim().toLowerCase();
        return skills.filter((skill) => (scope === "all" || skill.scope === scope) && (!search || [skill.name, skill.description, skill.interface?.displayName, skill.interface?.shortDescription, skill.shortDescription].some((value) => value?.toLowerCase().includes(search))));
    }, [skills, keyword, scope]);
    const assistantBusy = sending || waiting;
    const skillBusy = Boolean(busy || generatingSource);

    useEffect(() => { if (!useAgentSkillStore.getState().loaded && !useAgentSkillStore.getState().loading) void loadSkills(); }, [loadSkills]);
    useEffect(() => { setCategory(ALL_PROMPTS_OPTION); setPromptDetail(null); setSkillDetail(null); }, [i18n.resolvedLanguage]);
    useEffect(() => { if (draft) setSkillEditor((current) => current || { draft }); }, [draft]);

    const changeKind = (value: string) => { setSearchParams(value === "all" ? {} : { kind: value }, { replace: true }); setCategory(ALL_PROMPTS_OPTION); };
    const revealPersonal = (value: InspirationKind) => { setScope("user"); setKeyword(""); changeKind(value); };
    const refresh = () => Promise.allSettled([queryClient.invalidateQueries({ queryKey: ["prompts"] }), loadSkills()]);
    const run = async (key: string, action: () => Promise<void>) => {
        if (busyRef.current) return;
        busyRef.current = true;
        setBusy(key);
        try { await action(); }
        catch (error) { notify.error(error instanceof Error ? error.message : t("workspace.operationFailed")); }
        finally { busyRef.current = false; setBusy(""); }
    };
    const useSkill = (skill: AgentSkillSummary) => {
        useAgentSkillStore.getState().selectSkill(skill);
        useAgentStore.setState({ activeTab: "chat" });
        useAgentStore.getState().openPanel();
    };
    const readSkill = (skill: AgentSkillSummary, edit = false) => run(skill.path, async () => {
        const response = await fetchAssistantSkill(skill.name);
        if (!response.data) throw new Error(t("agent.skillManager.contentMissing"));
        if (edit) setSkillEditor({ detail: response.data });
        else setSkillDetail(response.data);
    });
    const toggleSkill = (skill: AgentSkillSummary, enabled: boolean) => run(skill.path, async () => {
        await setAssistantSkillEnabled(skill, enabled);
        await loadSkills();
    });
    const removeSkill = (skill: AgentSkillSummary) => {
        const assertSession = captureSession();
        confirm({ title: t("agent.skillManager.deleteTitle", { name: skill.interface?.displayName || skill.name }), content: t("agent.skillManager.deleteDescription"), destructive: true, confirmText: t("common.delete"), onConfirm: async () => {
            assertSession();
            await deleteAssistantSkill(skill.name, skill.revision);
            if (skillDetail?.name === skill.name) setSkillDetail(null);
            await loadSkills();
            notify.success(t("agent.skillManager.deleted"));
        } });
    };
    const removePrompt = (prompt: Prompt) => {
        const assertSession = captureSession();
        confirm({ title: t("prompts.deleteTitle", { name: prompt.title }), content: t("prompts.deleteDescription"), destructive: true, confirmText: t("common.delete"), onConfirm: async () => {
            assertSession();
            await deletePrompt(prompt.id, prompt.version);
            if (promptDetail?.id === prompt.id) setPromptDetail(null);
            await queryClient.invalidateQueries({ queryKey: ["prompts"] });
            notify.success(t("prompts.deleted"));
        } });
    };
    const generateDraft = async () => {
        if (!draftSource || useAgentSkillStore.getState().generatingSource) return;
        const source = draftSource;
        const agent = useAgentStore.getState();
        if (agent.sending || agent.waiting) throw new Error(t("agent.skillManager.codexBusy"));
        if (source === "conversation" && !hasSettledConversation(agent.messages, agent.activeThreadId)) throw new Error(t("agent.skillManager.noConversation"));
        if (source === "canvas" && !sourceProjectId) throw new Error(t("skills.selectProject"));
        const assertSession = captureSession();
        const revision = useAgentSkillStore.getState().connectionRevision;
        useAgentSkillStore.getState().setGeneratingSource(source);
        try {
            const config = useConfigStore.getState().config, model = agent.model || config.assistantModel, selected = decodeChannelModel(model);
            const entry = config.channels.find((channel) => channel.id === selected?.channelId)?.models.find((item) => item.name === selected?.model && item.capability === "text");
            if (!entry) throw new Error(t("workspace.selectAssistantModel"));
            const parameters = resolveModelParameters(config, model, agent.modelParameters[model]);
            for (const control of entry.parameters) if (control.type === "asset" && parameters[control.key]) { const id = assetId(String(parameters[control.key])); if (!id) throw new Error(t("errors.parameterAssetRequired", { name: control.label })); parameters[control.key] = id; }
            const response = await createAssistantSkillDraft({ source, threadId: agent.activeThreadId, projectId: source === "canvas" ? sourceProjectId : undefined, model, parameters });
            assertSession();
            if (!response.data) throw new Error(t("agent.skillManager.noDraft"));
            useAgentSkillStore.getState().setDraft(response.data);
            setDraftSource(null);
            notify.success(t("agent.skillManager.draftCreated"));
        } finally { if (useAgentSkillStore.getState().connectionRevision === revision) useAgentSkillStore.getState().setGeneratingSource(null); }
    };
    const createItems: MenuItem[] = [
        { key: "prompt", icon: <FileText />, label: t("prompts.create"), onClick: () => setPromptEditor({ prompt: null }) },
        { key: "skill", icon: <Sparkles />, label: t("inspiration.newSkill"), disabled: Boolean(generatingSource), onClick: () => setSkillEditor({}) },
        { type: "divider" },
        { key: "conversation", icon: <MessageSquareText />, label: t("agent.skillManager.fromConversation"), disabled: assistantBusy || !hasConversation || Boolean(generatingSource), onClick: () => setDraftSource("conversation") },
        { key: "canvas", icon: <Workflow />, label: t("agent.skillManager.fromCanvas"), disabled: assistantBusy || Boolean(generatingSource), onClick: () => { setSourceProjectId(useAgentStore.getState().canvasContext?.snapshot.projectId || ""); setDraftSource("canvas"); } },
    ];

    const skillsSection = <section aria-label={t("inspiration.skills")}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div><h2 className="text-base font-medium">{t("inspiration.skills")}</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">{t("inspiration.skillsHint")}</p></div>
            {!skillsErrors.length && skillsLoaded ? <span className="text-xs text-muted-foreground" aria-live="polite">{t("inspiration.itemCount", { count: filteredSkills.length })}</span> : null}
        </div>
        {skillsErrors.length ? <Notice type="error" className="mt-4" title={t("agent.skillManager.readFailed")} description={skillsErrors.join("\n")} action={<Button loading={skillsLoading} onClick={() => void loadSkills()}>{t("common.retry")}</Button>} /> : null}
        {skillsLoading && !skillsLoaded ? <div className="flex h-40 items-center justify-center"><Spinner /></div> : <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">{filteredSkills.map((skill) => {
            const selected = selectedSkill?.name === skill.name && selectedSkill.path === skill.path;
            return <article key={skill.path} data-selected={selected} className="flex h-full min-h-40 min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card text-card-foreground transition-colors hover:border-foreground/25 data-[selected=true]:border-primary">
                <button type="button" onClick={() => void readSkill(skill)} disabled={Boolean(busy)} className="flex min-w-0 flex-1 flex-col p-3 pb-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-60">
                    <div className="mb-2 flex items-center justify-between gap-2 text-xs text-muted-foreground"><span className="inline-flex items-center gap-1.5"><Sparkles className="size-3.5" />{t("inspiration.skill")}</span><span>{t(skill.managed ? "inspiration.mine" : "inspiration.builtin")}</span></div>
                    <h3 className="line-clamp-2 text-sm font-medium leading-5">{skill.interface?.displayName || skill.name}</h3>
                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{skill.interface?.shortDescription || skill.shortDescription || skill.description}</p>
                </button>
                <div className="flex items-center gap-1 px-2 pb-2">
                    {skill.managed ? <div className="mr-auto flex min-w-0 items-center gap-1.5 pl-1">
                        <Switch size="small" aria-label={t("inspiration.skillStatus", { name: skill.interface?.displayName || skill.name })} checked={skill.enabled} loading={busy === skill.path} disabled={skillBusy} onChange={(enabled) => void toggleSkill(skill, enabled)} />
                        <span className="truncate text-xs text-muted-foreground">{t(skill.enabled ? "agent.skillManager.enabled" : "agent.skillManager.disabled")}</span>
                    </div> : null}
                    <div className="ml-auto flex items-center gap-0.5">
                        {skill.managed ? <Menu placement="bottomRight" disabled={skillBusy} items={[
                            { key: "edit", icon: <FilePenLine />, label: t("common.edit"), onClick: () => void readSkill(skill, true) },
                            { key: "delete", icon: <Trash2 />, label: t("common.delete"), danger: true, onClick: () => removeSkill(skill) },
                        ]}><Button variant="ghost" size="icon" className="size-7" title={t("inspiration.moreActions", { name: skill.interface?.displayName || skill.name })} aria-label={t("inspiration.moreActions", { name: skill.interface?.displayName || skill.name })} disabled={skillBusy}><Ellipsis className="size-4" /></Button></Menu> : null}
                        <Button variant="ghost" size="icon" className="size-7" disabled={!skill.enabled || Boolean(busy)} title={t("inspiration.useSkill")} aria-label={t("inspiration.useSkill")} aria-pressed={selected} onClick={() => useSkill(skill)}>{selected ? <Check className="size-4" /> : <Sparkles className="size-4" />}</Button>
                    </div>
                </div>
            </article>;
        })}</div>}
        {skillsLoaded && !skillsLoading && !skillsErrors.length && !filteredSkills.length ? <EmptyState description={t(scope === "user" && !keyword ? "inspiration.noSkills" : "agent.skillManager.noMatch")} /> : null}
    </section>;

    const promptsSection = <section aria-label={t("inspiration.prompts")}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div><h2 className="text-base font-medium">{t("inspiration.prompts")}</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">{t("inspiration.promptsHint")}</p></div>
            <div className="flex items-center gap-3">
                {!prompts.query.isError && !prompts.query.isPending ? <span className="text-xs text-muted-foreground" aria-live="polite">{t("inspiration.itemCount", { count: prompts.total })}</span> : null}
                <Choice compact className="w-40" aria-label={t("prompts.category")} value={category} onChange={setCategory} options={prompts.categories.map((value) => ({ value, label: value === ALL_PROMPTS_OPTION ? t("inspiration.allCategories") : value }))} />
            </div>
        </div>
        {prompts.query.error ? <Notice type="error" className="mt-4" title={t("prompts.loadFailed")} description={prompts.query.error.message} action={<Button onClick={() => void prompts.query.refetch()}>{t("common.retry")}</Button>} /> : null}
        {prompts.query.isLoading ? <div className="flex h-40 items-center justify-center"><Spinner /></div> : <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">{prompts.items.map((prompt) => <PromptCard key={prompt.id} item={prompt} onOpen={() => setPromptDetail(prompt)} onCopy={() => void copyText(prompt.prompt, t("common.promptCopied"))} extraAction={!prompt.builtIn ? <Menu placement="bottomRight" disabled={Boolean(busy)} items={[
            { key: "edit", icon: <FilePenLine />, label: t("common.edit"), onClick: () => void run(prompt.id, async () => setPromptEditor({ prompt: await fetchPrompt(prompt.id) })) },
            { key: "delete", icon: <Trash2 />, label: t("common.delete"), danger: true, onClick: () => removePrompt(prompt) },
        ]}><Button variant="ghost" size="icon" className="size-7" title={t("inspiration.moreActions", { name: prompt.title })} aria-label={t("inspiration.moreActions", { name: prompt.title })} disabled={Boolean(busy)} loading={busy === prompt.id}><Ellipsis className="size-4" /></Button></Menu> : null} />)}</div>}
        {!prompts.query.isLoading && !prompts.query.isError && !prompts.items.length ? <EmptyState description={t(scope === "user" && !keyword && category === ALL_PROMPTS_OPTION ? "prompts.personalEmpty" : "prompts.empty")} /> : null}
        {prompts.query.hasNextPage ? <div className="py-5 text-center"><Button variant="ghost" loading={prompts.query.isFetchingNextPage} onClick={() => void prompts.query.fetchNextPage()}>{t("prompts.more")}</Button></div> : null}
    </section>;
    const content = <div className="space-y-9 pt-3">{showSkills ? skillsSection : null}{showPrompts ? promptsSection : null}</div>;

    return <main className="h-full overflow-y-auto bg-background px-4 py-6 text-foreground sm:px-6 lg:py-8">
        <div className="mx-auto max-w-7xl">
            <PageHeader title={t("inspiration.title")} description={t("inspiration.description")} actions={<>
                <Button variant="ghost" size="icon" title={t("inspiration.refresh")} loading={skillsLoading || prompts.query.isFetching} onClick={() => void refresh()}><RefreshCw className="size-4" /></Button>
                <Menu placement="bottomRight" disabled={Boolean(busy)} items={createItems}><Button variant="default" disabled={Boolean(busy)} icon={<Plus className="size-4" />}>{t("inspiration.create")}<ChevronDown className="size-3.5" /></Button></Menu>
            </>} />
            <div className="mb-3 mt-6 flex flex-wrap items-center gap-3">
                <Input className="min-w-0 flex-1 basis-56" prefix={<Search className="size-4" />} aria-label={t("inspiration.search")} placeholder={t("inspiration.search")} value={keyword} onChange={(event) => setKeyword(event.target.value)} />
                <Choice<PromptScope> className="w-36" aria-label={t("inspiration.scope")} value={scope} onChange={(value) => { setScope(value); setCategory(ALL_PROMPTS_OPTION); }} options={(["all", "builtin", "user"] as const).map((value) => ({ value, label: t(`inspiration.scopes.${value}`) }))} />
            </div>
            <Tabs.Root value={kind} onValueChange={changeKind} className="min-w-0">
                <div className="thin-scrollbar mb-4 overflow-x-auto overflow-y-hidden pb-2">
                    <Tabs.List aria-label={t("inspiration.browseByType")} className="inline-flex w-max items-center gap-1 rounded-xl bg-muted p-1">
                        {kinds.map(({ key, icon: Icon }) => <Tabs.Trigger key={key} value={key} className="inline-flex h-8 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md px-3 text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[state=active]:bg-card data-[state=active]:text-card-foreground data-[state=active]:shadow-sm"><Icon className="size-4" />{t(`inspiration.kinds.${key}`)}</Tabs.Trigger>)}
                    </Tabs.List>
                </div>
                {kinds.map(({ key }) => <InspirationTabPanel key={key} value={key} active={key === kind}>{key === kind ? content : null}</InspirationTabPanel>)}
            </Tabs.Root>
        </div>

        <PromptDetailDialog prompt={promptDetail} onClose={() => setPromptDetail(null)} onCopy={(prompt) => void copyText(prompt, t("common.promptCopied"))} />
        {promptEditor ? <PromptEditorDialog prompt={promptEditor.prompt} onClose={() => setPromptEditor(null)} onSaved={(type) => { setPromptEditor(null); setPromptDetail(null); revealPersonal(type); }} /> : null}
        {skillEditor ? <SkillEditorDialog editor={skillEditor} onClose={() => { setSkillEditor(null); useAgentSkillStore.getState().setDraft(null); }} onSaved={() => { setSkillEditor(null); setSkillDetail(null); revealPersonal("skills"); }} /> : null}
        <Dialog open={Boolean(skillDetail)} title={skillDetail?.interface?.displayName || skillDetail?.name || t("inspiration.skill")} description={skillDetail?.description} footer={null} width={760} onClose={() => setSkillDetail(null)}>
            <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-6">{skillDetail?.instructions}</pre>
        </Dialog>
        <Dialog title={t("inspiration.extractSkill")} open={Boolean(draftSource)} onClose={() => setDraftSource(null)} confirmText={t("skills.generateDraft")} confirmDisabled={Boolean(generatingSource) || assistantBusy || draftSource === "canvas" && (!sourceProjectId || Boolean(projectsError))} onConfirm={generateDraft}>
            <p className="text-sm leading-6 text-muted-foreground">{t("skills.draftCost")}</p>
            {draftSource === "canvas" ? <div className="mt-5 space-y-3"><label className="text-sm font-medium" htmlFor="skill-source-project">{t("skills.selectProject")}</label><Choice id="skill-source-project" value={sourceProjectId} onChange={setSourceProjectId} placeholder={t("skills.selectProject")} options={projects.map((project) => ({ value: project.id, label: project.title }))} />{projectsError ? <Notice type="error" title={projectsError} action={<Button onClick={() => void useCanvasStore.getState().loadProjects()}>{t("common.retry")}</Button>} /> : null}</div> : <p className="mt-4 text-sm">{t("agent.skillManager.conversationDescription")}</p>}
        </Dialog>
    </main>;
}

function InspirationTabPanel({ value, active, children }: { value: InspirationKind; active: boolean; children: ReactNode }) {
    const [content, setContent] = useState(children);
    // Retain the outgoing view until Animate UI completes its exit animation.
    if (active && content !== children) setContent(children);
    return <Tabs.Content value={value} className="outline-none focus-visible:ring-2 focus-visible:ring-ring">{active ? children : content}</Tabs.Content>;
}

function hasSettledConversation(messages: AgentChatItem[], threadId: string) {
    return Boolean(threadId && messages.some((item) => item.role === "assistant" && item.threadId === threadId && item.turnId && !item.streamId && item.text.trim() && messages.some((source) => source.role === "user" && source.threadId === threadId && source.turnId === item.turnId)));
}
