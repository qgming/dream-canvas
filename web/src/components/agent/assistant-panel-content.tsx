import { useTranslation } from "react-i18next";
import appI18n from "@/i18n";
import { useEffect, useRef, useState } from "react";
import { Notice as Alert, Spinner } from "@/components/ui/display";
import { useFeedback } from "@/hooks/use-feedback";
import { Button } from "@/components/ui/button";
import { Choice } from "@/components/ui/choice";
import { History, MessageSquare, Plus, RefreshCw, Settings2, Sparkles, X } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { useAgentStore } from "@/stores/use-agent-store";
import { useAgentSkillStore } from "@/stores/use-agent-skill-store";
import { useAuthStore } from "@/stores/use-auth-store";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { decodeChannelModel, resolveModelParameters, useEffectiveConfig } from "@/stores/use-config-store";
import { ModelPicker } from "@/components/model-picker";
import { ModelParameters } from "@/components/model-parameters";
import { Popover } from "@/components/ui/popover";
import { AgentPanelTabs } from "./agent-panel-tabs";
import { AgentChatTimeline } from "./agent-chat";
import { AgentChatComposer } from "./agent-chat-composer";
import { AgentHistoryView } from "./agent-history-view";
import * as api from "@/services/api/assistant";
import { uploadImage } from "@/services/image-storage";
import { assetId, assetUrl } from "@/services/api/assets";
import { captureSession } from "@/services/api/client";
import { nanoid } from "nanoid";
import { decideApproval } from "@/services/api/projects";
import { inputVisible } from "@/lib/model-inputs";

export function AssistantPanelContent() {
    useTranslation();
    const { notify, confirm } = useFeedback();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const user = useAuthStore((state) => state.user);
    const config = useEffectiveConfig();
    const { pathname } = useLocation();
    const navigate = useNavigate();
    const routeProject = /^\/canvas\/([^/]+)$/.exec(pathname)?.[1] || "";
    const projects = useCanvasStore((state) => state.projects);
    const [target, setTarget] = useState("");
    const targetRef = useRef("");
    const routeProjectRef = useRef(routeProject);
    routeProjectRef.current = routeProject;
    const followedTurn = useRef<{ threadId: string; turnId: string; projectId: string } | null>(null);
    const chooseTarget = (projectId: string) => { targetRef.current = projectId; setTarget(projectId); };
    const activeTab = useAgentStore((state) => state.activeTab);
    const tab = activeTab === "history" ? activeTab : "chat";
    const setTab = (activeTab: "chat" | "history") => useAgentStore.setState({ activeTab });
    const [snapshot, setSnapshot] = useState<api.AssistantSnapshot | null>(null);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const [creating, setCreating] = useState(false);
    const creatingRef = useRef(false);
    const [submitting, setSubmitting] = useState(false);
    const submittingRef = useRef(false);
    const [stopping, setStopping] = useState(false);
    const [deciding, setDeciding] = useState("");
    const stoppingRef = useRef(false);
    const sequence = useRef(0);
    const activeId = useAgentStore((state) => state.activeThreadId);
    const requestedThread = useRef(activeId);
    const threads = useAgentStore((state) => state.threads);
    const prompt = useAgentStore((state) => state.prompt);
    const model = useAgentStore((state) => state.model);
    const modelParameters = useAgentStore((state) => state.modelParameters);
    const selectedModel = model || config.assistantModel;
    useEffect(() => { if (!useAgentStore.getState().model && config.assistantModel) useAgentStore.setState({ model: config.assistantModel }); }, [config.assistantModel]);
    const selected = decodeChannelModel(selectedModel);
    const modelEntry = config.channels.find((channel) => channel.id === selected?.channelId)?.models.find((entry) => entry.name === selected?.model && entry.capability === "text" && entry.features.tools);
    const attachments = useAgentStore((state) => state.attachments);
    const selectedSkill = useAgentSkillStore((state) => state.selectedSkill);
    const running = snapshot?.turns.find((turn) => ["queued", "running", "waiting_approval", "waiting_tasks"].includes(turn.status));
    const reportedTurn = running || snapshot?.turns.at(-1);
    const busy = Boolean(running || submitting || creating);
    useEffect(() => { useAgentStore.setState({ sending: submitting, waiting: Boolean(running) }); }, [submitting, running?.id]);
    useEffect(() => { chooseTarget(routeProject); }, [routeProject]);
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
            const latest = record.turns.at(-1), previous = followedTurn.current;
            if (latest?.projectId && !routeProjectRef.current && !targetRef.current && (switching || previous?.threadId === id && previous.turnId === latest.id && !previous.projectId)) chooseTarget(latest.projectId);
            followedTurn.current = latest ? { threadId: id, turnId: latest.id, projectId: latest.projectId || "" } : null;
            const running = record.turns.find((turn) => ["queued", "running", "waiting_approval", "waiting_tasks"].includes(turn.status));
            useAgentStore.setState({ activeThreadId: id, connectError: "", messages: record.items.map((item) => {
                const detail = item.detail as { attachments?: string[]; skill?: string } | undefined;
                return { ...item, itemId: item.id, streamId: item.role === "assistant" && item.turnId === running?.id && running.status === "running" ? item.id : undefined, attachments: detail?.attachments?.map((asset) => ({ id: asset, name: appI18n.t("workspace.image"), url: assetUrl(asset) })), skill: detail?.skill ? { name: detail.skill, path: `skill:${detail.skill}` } : undefined };
            }), pendingApprovals: record.approvals.map((approval) => ({ requestId: approval.id, method: approval.action, reason: approval.targetId, threadId: id, turnId: running?.id })), activeTurnId: running?.id || "" });
            if (activate) setTab("chat");
        } catch (error) { if (request === sequence.current) showError(error); }
        finally { if (request === sequence.current) setLoading(false); }
    };
    const newThread = async () => {
        if (creatingRef.current || busy) return;
        creatingRef.current = true; setCreating(true);
        const assertSession = captureSession();
        try { const thread = await api.createThread(); assertSession(); chooseTarget(routeProjectRef.current); await refreshThreads(); assertSession(); await openThread(thread.id); }
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
        let refreshing = false, pending = false, disposed = false;
        const refresh = async (event: Event) => {
            const topic = (event as CustomEvent<string>).detail;
            if (topic && topic !== "all" && topic !== "assistant") return;
            pending = true;
            if (refreshing) return;
            refreshing = true;
            try { while (pending && !disposed) { pending = false; if (!topic || topic === "all") await refreshThreads(); const id = useAgentStore.getState().activeThreadId; if (id && !disposed) await openThread(id, false); } }
            catch (error) { if (!disposed) showError(error); }
            finally { refreshing = false; }
        };
        window.addEventListener("server-changed", refresh);
        return () => { disposed = true; window.removeEventListener("server-changed", refresh); };
    }, [user?.id]);
    const send = async () => {
        if (submittingRef.current) return;
        const entry = modelEntry;
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
            const parameters = resolveModelParameters(config, selectedModel, modelParameters[selectedModel]);
            for (const control of entry.parameters) {
                if (control.type === "reference" || !inputVisible(control, parameters)) continue;
                const value = parameters[control.key];
                if (value == null || typeof value === "string" && !value.trim()) { if (control.required) throw new Error(appI18n.t("errors.parameterRequired", { name: control.label })); continue; }
                if (control.type === "asset") {
                    if (typeof value === "string" && value.startsWith("deleted-asset:")) throw new Error(appI18n.t("errors.parameterAssetDeleted", { name: control.label }));
                    const id = typeof value === "string" ? assetId(value) : undefined;
                    if (!id) throw new Error(appI18n.t("errors.parameterAssetRequired", { name: control.label }));
                    parameters[control.key] = id;
                }
            }
            const thread = snapshot?.thread || await api.createThread();
            assertSession();
            if (!snapshot) { await refreshThreads(); await openThread(thread.id); }
            assertSession();
            const context = useAgentStore.getState().canvasContext;
            await api.startTurn(thread.id, { prompt: text, projectId: destination || undefined, clientId: context?.snapshot.projectId === destination ? context.clientId : undefined, channelId: selected.channelId, modelId: entry.id, parameters, version: thread.version, skill: selectedSkill?.name, attachments: attachments.map((item) => assetId(item.url) || ""), references: references.map((item) => item.nodeId) });
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
            <AgentPanelTabs value={tab} theme={theme} onChange={setTab} items={[{ value: "chat", label: appI18n.t("workspace.chat"), icon: <MessageSquare className="size-4" /> }, { value: "history", label: appI18n.t("workspace.history"), icon: <History className="size-4" /> }]} right={<><Button variant="ghost" icon={<Sparkles className="size-4" />} title={appI18n.t("inspiration.title")} onClick={() => { navigate("/inspiration?kind=skills"); useAgentStore.getState().closePanel(); }} /><Button variant="ghost"  icon={<Plus className="size-4" />} disabled={loading || busy} onClick={() => void newThread()} aria-label={appI18n.t("workspace.newConversation")} /><Button variant="ghost"  icon={<X className="size-4" />} onClick={() => useAgentStore.getState().closePanel()} aria-label={appI18n.t("workspace.collapseAssistant")} /></>} />
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
            <div hidden={tab !== "chat"} inert={tab !== "chat"} className={tab === "chat" ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
                <div className="flex shrink-0 items-center gap-2 px-4 pt-3 text-xs" style={{ color: theme.node.muted }}><span>{appI18n.t("workspace.targetProject")}</span><Choice compact borderless aria-label={appI18n.t("workspace.targetProject")} className="min-w-0 flex-1" value={running ? running.projectId || "" : target} disabled={busy} onChange={chooseTarget} options={[{ value: "", label: appI18n.t("workspace.noProject") }, ...projects.map((project) => ({ value: project.id, label: project.title }))]} /><Button variant="ghost" size="sm" icon={<RefreshCw className="size-3.5" />} disabled={loading} onClick={() => activeId ? void openThread(activeId) : void refreshThreads().catch(showError)} aria-label={appI18n.t("workspace.reloadConversation")} /></div>
                {loading ? <div className="flex justify-center px-4 pt-3"><Spinner size="small" /></div> : null}
                {running?.status === "waiting_tasks" ? <p role="status" className="px-4 pt-3 text-xs text-muted-foreground">{appI18n.t("workspace.assistantWaitingTasks")}</p> : null}
                {reportedTurn?.error ? <Alert className="mx-4 mt-3" type={reportedTurn.status === "failed" || reportedTurn.status === "interrupted" ? "error" : "warning"} title={reportedTurn.error} /> : null}
                {!snapshot && !loading ? <p className="px-5 pt-8 text-sm leading-6" style={{ color: theme.node.muted }}>{appI18n.t("workspace.assistantBoundary")}</p> : null}
                {snapshot?.approvals.map((approval) => <Alert key={approval.id} type="warning" className="mx-4 mt-3" title={appI18n.t(approval.action === "delete_asset" ? "workspace.globalDeleteAsset" : "workspace.deleteProject")} description={approval.targetId} action={<div className="flex gap-2"><Button size="sm" disabled={Boolean(deciding)} onClick={async () => { setDeciding(approval.id); try { await decideApproval(approval.id, false); await openThread(activeId, false); } catch (error) { showError(error); } finally { setDeciding(""); } }}>{appI18n.t("workspace.reject")}</Button><Button size="sm" variant="destructive" disabled={Boolean(deciding)} loading={deciding === approval.id} onClick={async () => { setDeciding(approval.id); try { await decideApproval(approval.id, true); await openThread(activeId, false); } catch (error) { showError(error); } finally { setDeciding(""); } }}>{appI18n.t("workspace.confirm")}</Button></div>} />)}
                <AgentChatTimeline visible={tab === "chat"} theme={theme} pendingTool={null} pendingApprovals={[]} sending={submitting} waiting={Boolean(running)} onRejectTool={() => {}} onApproveTool={() => {}} onApprovalDecision={() => {}} />
                <AgentChatComposer model={<ModelPicker config={config} value={selectedModel} capability="text" toolsOnly disabled={busy || loading} className="min-w-0 max-w-48" onChange={(model) => useAgentStore.setState({ model })} />} theme={theme} prompt={prompt} attachments={attachments} sending={busy} stopping={stopping} disabled={loading} placeholder={appI18n.t("workspace.assistantPrompt")} onPromptChange={(prompt) => useAgentStore.setState({ prompt })} onSubmit={() => void send()} onStop={running ? () => void stop() : undefined} onAddFiles={async (files) => {
                    const assertSession = captureSession();
                    try { for (const file of Array.from(files || [])) { assertSession(); const image = await uploadImage(file); assertSession(); useAgentStore.setState((state) => ({ attachments: [...state.attachments, { id: nanoid(), name: file.name, type: image.mimeType, size: image.bytes, width: image.width, height: image.height, url: image.url, dataUrl: image.url }] })); } }
                    catch (error) { showError(error); }
                }} onRemoveAttachment={(id) => useAgentStore.setState((state) => ({ attachments: state.attachments.filter((item) => item.id !== id) }))} left={modelEntry?.parameters.length ? <Popover trigger="click" placement="topLeft" className="w-[356px]" content={<ModelParameters config={config} model={selectedModel} value={modelParameters[selectedModel]} disabled={busy || loading} onChange={(value) => useAgentStore.setState((state) => ({ modelParameters: { ...state.modelParameters, [selectedModel]: value } }))} />}><Button variant="ghost" size="sm" icon={<Settings2 className="size-4" />} aria-label={appI18n.t("workspace.parameters")} /></Popover> : null} />
            </div>
        </>
    );
}
