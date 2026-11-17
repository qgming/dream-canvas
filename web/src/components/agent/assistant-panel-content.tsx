import { useTranslation } from "react-i18next";
import appI18n from "@/i18n";
import { useEffect, useRef, useState } from "react";
import { Notice as Alert, Spinner } from "@/components/ui/display";
import { useFeedback } from "@/hooks/use-feedback";
import { Button } from "@/components/ui/button";
import { Choice } from "@/components/ui/choice";
import { History, MessageSquare, Plus, RefreshCw, Sparkles, X } from "lucide-react";
import { useLocation } from "react-router-dom";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { useAgentStore } from "@/stores/use-agent-store";
import { useAgentSkillStore } from "@/stores/use-agent-skill-store";
import { useAuthStore } from "@/stores/use-auth-store";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { decodeChannelModel, useEffectiveConfig } from "@/stores/use-config-store";
import { ModelPicker } from "@/components/model-picker";
import { AgentPanelTabs } from "./agent-panel-tabs";
import { AgentChatTimeline } from "./agent-chat";
import { AgentChatComposer } from "./agent-chat-composer";
import { AgentHistoryView } from "./agent-history-view";
import { AgentSkillsView } from "./agent-skills-view";
import * as api from "@/services/api/assistant";
import { uploadImage } from "@/services/image-storage";
import { assetId } from "@/services/api/assets";
import { captureSession } from "@/services/api/client";
import { nanoid } from "nanoid";

export function AssistantPanelContent() {
    useTranslation();
    const { notify, confirm } = useFeedback();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const user = useAuthStore((state) => state.user);
    const config = useEffectiveConfig();
    const { pathname } = useLocation();
    const routeProject = /^\/canvas\/([^/]+)$/.exec(pathname)?.[1] || "";
    const projects = useCanvasStore((state) => state.projects);
    const [target, setTarget] = useState("");
    const activeTab = useAgentStore((state) => state.activeTab);
    const tab = activeTab === "history" || activeTab === "skills" ? activeTab : "chat";
    const setTab = (activeTab: "chat" | "history" | "skills") => useAgentStore.setState({ activeTab });
    const [snapshot, setSnapshot] = useState<api.AssistantSnapshot | null>(null);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const [creating, setCreating] = useState(false);
    const creatingRef = useRef(false);
    const [submitting, setSubmitting] = useState(false);
    const submittingRef = useRef(false);
    const [stopping, setStopping] = useState(false);
    const stoppingRef = useRef(false);
    const sequence = useRef(0);
    const activeId = useAgentStore((state) => state.activeThreadId);
    const requestedThread = useRef(activeId);
    const threads = useAgentStore((state) => state.threads);
    const prompt = useAgentStore((state) => state.prompt);
    const model = useAgentStore((state) => state.model);
    const attachments = useAgentStore((state) => state.attachments);
    const selectedSkill = useAgentSkillStore((state) => state.selectedSkill);
    const running = snapshot?.turns.find((turn) => ["queued", "running", "waiting_approval"].includes(turn.status));
    const busy = Boolean(running || submitting || creating);
    useEffect(() => { useAgentStore.setState({ sending: submitting, waiting: Boolean(running) }); }, [submitting, running?.id]);
    useEffect(() => { if (user) void useAgentSkillStore.getState().loadSkills("/api", ""); }, [user?.id]);
    useEffect(() => { setTarget(routeProject); }, [routeProject]);
    const showError = (error: unknown) => { const text = error instanceof Error ? error.message : appI18n.t("workspace.operationFailed"); setError(text); useAgentStore.setState({ connectError: text }); };
    const refreshThreads = async () => {
        const owner = user?.id;
        const records = await api.listThreads();
        if (useAuthStore.getState().user?.id !== owner) return;
        useAgentStore.setState({ threads: records.map((thread) => ({ id: thread.id, name: thread.title, preview: "", createdAt: Date.parse(thread.createdAt), updatedAt: Date.parse(thread.updatedAt) })), connected: true, enabled: true, activity: appI18n.t("workspace.serviceConnected") });
    };
    const openThread = async (id: string, activate = true) => {
        if (!activate && requestedThread.current !== id) return;
        const switching = requestedThread.current !== id;
        requestedThread.current = id;
        if (activate && switching) { setSnapshot(null); useAgentStore.setState({ activeThreadId: id, activeTurnId: "", messages: [] }); }
        const request = ++sequence.current;
        const assertSession = captureSession();
        setLoading(true);
        try {
            const record = await api.getThread(id);
            assertSession();
            if (request !== sequence.current || useAuthStore.getState().user?.id !== user?.id) return;
            setSnapshot(record); setError("");
            useAgentStore.setState({ activeThreadId: id, connectError: "", messages: record.items.map((item) => ({ ...item, itemId: item.id })), activeTurnId: record.turns.find((turn) => ["queued", "running", "waiting_approval"].includes(turn.status))?.id || "" });
            if (activate) setTab("chat");
        } catch (error) { if (request === sequence.current) showError(error); }
        finally { if (request === sequence.current) setLoading(false); }
    };
    const newThread = async () => {
        if (creatingRef.current || busy) return;
        creatingRef.current = true; setCreating(true);
        const assertSession = captureSession();
        try { const thread = await api.createThread(); assertSession(); await refreshThreads(); assertSession(); await openThread(thread.id); }
        catch (error) { showError(error); }
        finally { creatingRef.current = false; setCreating(false); }
    };
    useEffect(() => {
        void refreshThreads().catch(showError);
        const id = useAgentStore.getState().activeThreadId;
        if (id) void openThread(id, false);
        return () => { sequence.current++; };
    }, [user?.id]);
    useEffect(() => {
        const refresh = () => { void refreshThreads().catch(showError); const id = useAgentStore.getState().activeThreadId; if (id) void openThread(id, false); };
        window.addEventListener("server-changed", refresh);
        return () => window.removeEventListener("server-changed", refresh);
    }, [user?.id]);
    const send = async () => {
        if (submittingRef.current) return;
        const selected = decodeChannelModel(model || config.textModel);
        const entry = config.channels.find((channel) => channel.id === selected?.channelId)?.models.find((entry) => entry.name === selected?.model && entry.capability === "text");
        if (!selected || !entry) { notify.warning(appI18n.t("workspace.selectAssistantModel")); return; }
        const destination = target;
        const text = prompt;
        const owner = user?.id;
        const assertSession = captureSession();
        if (!text.trim() || busy || loading) return;
        const references = useAgentStore.getState().canvasReferences;
        if (references.length && useAgentStore.getState().canvasContext?.snapshot.projectId !== destination) { notify.warning(appI18n.t("workspace.referencesProject")); return; }
        submittingRef.current = true; setSubmitting(true);
        try {
            const thread = snapshot?.thread || await api.createThread();
            assertSession();
            if (!snapshot) { await refreshThreads(); await openThread(thread.id); }
            assertSession();
            await api.startTurn(thread.id, { prompt: text, projectId: destination || undefined, channelId: selected.channelId, modelId: entry.id, version: thread.version, skill: selectedSkill?.name, attachments: attachments.map((item) => assetId(item.url) || ""), references: references.map((item) => item.nodeId) });
            if (useAuthStore.getState().user?.id !== owner) return;
            useAgentStore.setState({ prompt: "", attachments: [], canvasReferences: [] });
            await openThread(thread.id);
        } catch (error) { showError(error); }
        finally { submittingRef.current = false; setSubmitting(false); }
    };
    const stop = async () => {
        if (!running || stoppingRef.current) return;
        stoppingRef.current = true; setStopping(true);
        const assertSession = captureSession();
        try { await api.cancelTurn(running.id); assertSession(); await openThread(activeId); }
        catch (error) { showError(error); }
        finally { stoppingRef.current = false; setStopping(false); }
    };
    return (
        <>
            <AgentPanelTabs value={tab} theme={theme} onChange={setTab} items={[{ value: "chat", label: appI18n.t("workspace.chat"), icon: <MessageSquare className="size-4" /> }, { value: "history", label: appI18n.t("workspace.history"), icon: <History className="size-4" /> }, { value: "skills", label: "Skill", icon: <Sparkles className="size-4" /> }]} right={<><Button variant="ghost"  icon={<Plus className="size-4" />} disabled={loading || busy} onClick={() => void newThread()} aria-label={appI18n.t("workspace.newConversation")} /><Button variant="ghost"  icon={<X className="size-4" />} onClick={() => useAgentStore.getState().closePanel()} aria-label={appI18n.t("workspace.collapseAssistant")} /></>} />
            {error ? <Alert type="error" title={error} className="mx-3 mt-3" action={<Button size="sm" disabled={loading} onClick={() => { void refreshThreads().then(() => { setError(""); useAgentStore.setState({ connectError: "" }); if (activeId) return openThread(activeId, false); }).catch(showError); }}>{appI18n.t("workspace.retry")}</Button>} onClose={() => setError("")} /> : null}
            <div hidden={tab !== "history"} inert={tab !== "history"} className={tab === "history" ? "flex min-h-0 flex-1 flex-col" : "hidden"}><AgentHistoryView theme={theme} threads={threads} activeThreadId={activeId} workspacePath={appI18n.t("workspace.allConversations")} loading={loading} busy={busy} connected onRefresh={() => void refreshThreads().catch(showError)} onNewThread={() => void newThread()} onResumeThread={(id) => void openThread(id)} onDeleteThreads={(ids) => {
                const assertSession = captureSession();
                confirm({ title: appI18n.t("workspace.deleteConversations", { count: ids.length }), content: appI18n.t("workspace.deleteConversationDescription"), confirmText: appI18n.t("workspace.deleteConversation"), cancelText: appI18n.t("workspace.cancel"), destructive: true, onConfirm: async () => {
                    for (const id of ids) { assertSession(); await api.deleteThread(id); }
                    assertSession();
                    if (ids.includes(requestedThread.current)) { sequence.current++; requestedThread.current = ""; setSnapshot(null); setLoading(false); useAgentStore.setState({ activeThreadId: "", activeTurnId: "", messages: [] }); }
                    await refreshThreads();
                } });
            }} /></div>
            <div hidden={tab !== "skills"} inert={tab !== "skills"} className={tab === "skills" ? "flex min-h-0 flex-1 flex-col" : "hidden"}><AgentSkillsView clientId={user?.id || ""} /></div>
            <div hidden={tab !== "chat"} inert={tab !== "chat"} className={tab === "chat" ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
                <div className="flex shrink-0 items-center gap-2 px-4 pt-3 text-xs" style={{ color: theme.node.muted }}><span>{appI18n.t("workspace.targetProject")}</span><Choice compact borderless aria-label={appI18n.t("workspace.targetProject")} className="min-w-0 flex-1" value={running ? running.projectId || "" : target} disabled={busy} onChange={setTarget} options={[{ value: "", label: appI18n.t("workspace.noProject") }, ...projects.map((project) => ({ value: project.id, label: project.title }))]} /><Button variant="ghost" size="sm" icon={<RefreshCw className="size-3.5" />} disabled={loading} onClick={() => activeId ? void openThread(activeId) : void refreshThreads().catch(showError)} aria-label={appI18n.t("workspace.reloadConversation")} /></div>
                {loading ? <div className="flex justify-center px-4 pt-3"><Spinner size="small" /></div> : null}
                {!snapshot && !loading ? <p className="px-5 pt-8 text-sm leading-6" style={{ color: theme.node.muted }}>{appI18n.t("workspace.assistantBoundary")}</p> : null}
                <AgentChatTimeline visible={tab === "chat"} theme={theme} pendingTool={null} pendingApprovals={[]} sending={submitting} waiting={Boolean(running)} onRejectTool={() => {}} onApproveTool={() => {}} onApprovalDecision={() => {}} />
                <AgentChatComposer theme={theme} prompt={prompt} attachments={attachments} sending={busy} stopping={stopping} disabled={loading} placeholder={appI18n.t("workspace.assistantPrompt")} onPromptChange={(prompt) => useAgentStore.setState({ prompt })} onSubmit={() => void send()} onStop={running ? () => void stop() : undefined} onAddFiles={async (files) => {
                    const assertSession = captureSession();
                    try { for (const file of Array.from(files || [])) { assertSession(); const image = await uploadImage(file); assertSession(); useAgentStore.setState((state) => ({ attachments: [...state.attachments, { id: nanoid(), name: file.name, type: image.mimeType, size: image.bytes, width: image.width, height: image.height, url: image.url, dataUrl: image.url }] })); } }
                    catch (error) { showError(error); }
                }} onRemoveAttachment={(id) => useAgentStore.setState((state) => ({ attachments: state.attachments.filter((item) => item.id !== id) }))} left={<ModelPicker config={config} value={model || config.textModel} capability="text" onChange={(model) => useAgentStore.setState({ model })} />} />
            </div>
        </>
    );
}
