import { useTranslation } from "react-i18next";
import appI18n from "@/i18n";
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { useFeedback } from "@/hooks/use-feedback";

import { useAgentStore } from "@/stores/use-agent-store";
import { useAgentSkillStore } from "@/stores/use-agent-skill-store";
import { useAuthStore } from "@/stores/use-auth-store";
import { decodeChannelModel, resolveModelParameters, useEffectiveConfig } from "@/stores/use-config-store";
import * as api from "@/services/api/assistant";
import { uploadImage } from "@/services/image-storage";
import { assetId, assetUrl } from "@/services/api/assets";
import { ApiError, captureSession } from "@/services/api/client";
import { nanoid } from "nanoid";
import { inputVisible } from "@/lib/model-inputs";

const AssistantSessionContext = createContext<ReturnType<typeof useAssistantSessionState> | null>(null);

export function AssistantSessionProvider({ page, children }: { page: boolean; children: ReactNode }) {
    const session = useAssistantSessionState(page);
    return <AssistantSessionContext.Provider value={session}>{children}</AssistantSessionContext.Provider>;
}

export function useAssistantSession() {
    const session = useContext(AssistantSessionContext);
    if (!session) throw new Error("AssistantSessionProvider is missing");
    return session;
}

function useAssistantSessionState(page: boolean) {
    const { t } = useTranslation();
    const { notify, confirm } = useFeedback();
    const owner = useAuthStore((state) => state.user?.id);
    const config = useEffectiveConfig();
    const { pathname } = useLocation();
    const routeProject = /^\/canvas\/([^/]+)$/.exec(pathname)?.[1] || "";
    const [target, setTarget] = useState(routeProject);
    const targetRef = useRef(routeProject);
    const explicitTarget = useRef(false);
    const routeProjectRef = useRef(routeProject);
    const followedTurn = useRef<{ threadId: string; turnId: string; projectId: string } | null>(null);
    const chooseTarget = (projectId: string) => { targetRef.current = projectId; setTarget(projectId); };
    const selectTarget = (projectId: string) => { explicitTarget.current = true; chooseTarget(projectId); };
    const [snapshot, setSnapshot] = useState<api.AssistantSnapshot | null>(null);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const [loadingThreads, setLoadingThreads] = useState(false);
    const [renamingThread, setRenamingThread] = useState<api.AssistantThread | null>(null);
    const threadListRequest = useRef(0);
    const [creating, setCreating] = useState(false);
    const creatingRef = useRef(false);
    const [submitting, setSubmitting] = useState(false);
    const submittingRef = useRef(false);
    const [uploading, setUploading] = useState(false);
    const uploadingRef = useRef(false);
    const [stopping, setStopping] = useState(false);
    const stoppingRef = useRef(false);
    const sequence = useRef(0);
    const activeId = useAgentStore((state) => state.activeThreadId);
    const requestedThread = useRef(activeId);
    const threads = useAgentStore((state) => state.threads);
    const model = useAgentStore((state) => state.model);
    const modelParameters = useAgentStore((state) => state.modelParameters);
    const selectedModel = model || config.assistantModel;
    useEffect(() => { if (!useAgentStore.getState().model && config.assistantModel) useAgentStore.setState({ model: config.assistantModel }); }, [config.assistantModel]);
    const selected = decodeChannelModel(selectedModel);
    const modelEntry = config.channels.find((channel) => channel.id === selected?.channelId)?.models.find((entry) => entry.name === selected?.model && entry.capability === "text" && entry.features.tools);
    const running = snapshot?.turns.find((turn) => ["queued", "running", "waiting_tasks"].includes(turn.status));
    const reportedTurn = running || snapshot?.turns.at(-1);
    const busy = Boolean(running || submitting || creating);
    const editingDisabled = busy || loading || uploading || Boolean(activeId && !snapshot);
    useEffect(() => { useAgentStore.setState({ sending: submitting, waiting: Boolean(running) }); }, [submitting, running?.id]);
    useLayoutEffect(() => {
        const previousProject = routeProjectRef.current;
        routeProjectRef.current = routeProject;
        const { prompt, attachments, canvasReferences, sending, waiting } = useAgentStore.getState();
        if (!page && (routeProject || previousProject) && !explicitTarget.current && !prompt.trim() && !attachments.length && !canvasReferences.length && !sending && !waiting) chooseTarget(routeProject);
    }, [page, routeProject]);
    const showError = (error: unknown) => {
        if (useAuthStore.getState().user?.id !== owner) return;
        const text = error instanceof Error ? error.message : appI18n.t("workspace.operationFailed");
        setError(text); useAgentStore.setState({ connectError: text });
    };
    const clearThread = () => {
        sequence.current++;
        requestedThread.current = "";
        followedTurn.current = null;
        setSnapshot(null); setLoading(false);
        useAgentStore.setState({ activeThreadId: "", activeTurnId: "", messages: [] });
    };
    const refreshThreads = async () => {
        const request = ++threadListRequest.current;
        setLoadingThreads(true);
        try {
            const records = await api.listThreads();
            if (request !== threadListRequest.current || useAuthStore.getState().user?.id !== owner) return;
            useAgentStore.setState({ threads: records, connected: true, enabled: true, activity: appI18n.t("workspace.serviceConnected") });
        } catch (error) {
            if (request === threadListRequest.current && useAuthStore.getState().user?.id === owner) throw error;
        } finally { if (request === threadListRequest.current) setLoadingThreads(false); }
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
            if (request !== sequence.current || useAuthStore.getState().user?.id !== owner) return;
            setSnapshot(record); setError("");
            const latest = record.turns.at(-1), previous = followedTurn.current;
            if (latest?.projectId && !explicitTarget.current && !routeProjectRef.current && !targetRef.current && (switching || previous?.threadId === id && previous.turnId === latest.id && !previous.projectId)) chooseTarget(latest.projectId);
            followedTurn.current = latest ? { threadId: id, turnId: latest.id, projectId: latest.projectId || "" } : null;
            const running = record.turns.find((turn) => ["queued", "running", "waiting_tasks"].includes(turn.status));
            useAgentStore.setState({ activeThreadId: id, connectError: "", messages: record.items.map((item) => {
                const detail = item.detail as { streaming?: boolean; attachments?: string[]; skill?: string } | undefined;
                return { ...item, itemId: item.id, streamId: item.role === "assistant" && detail?.streaming && running?.status === "running" && item.turnId === running.id ? item.id : undefined, attachments: detail?.attachments?.map((asset) => ({ id: asset, name: appI18n.t("workspace.image"), url: assetUrl(asset) })), skill: detail?.skill ? { name: detail.skill, path: `skill:${detail.skill}` } : undefined };
            }), activeTurnId: running?.id || "" });
            if (activate) useAgentStore.setState({ activeTab: "chat" });
        } catch (error) {
            if (request !== sequence.current) return;
            if (error instanceof ApiError && error.status === 404) clearThread();
            else showError(error);
        }
        finally { if (request === sequence.current) setLoading(false); }
    };
    const newThread = async () => {
        if (creatingRef.current || busy || uploadingRef.current) return;
        creatingRef.current = true; setCreating(true);
        const assertSession = captureSession();
        try {
            const thread = await api.createThread();
            assertSession();
            if (!useAgentStore.getState().canvasReferences.length) { explicitTarget.current = false; chooseTarget(routeProjectRef.current); }
            await openThread(thread.id);
            await refreshThreads();
        }
        catch (error) { showError(error); }
        finally { creatingRef.current = false; setCreating(false); }
    };
    useEffect(() => {
        void refreshThreads().catch(showError);
        const id = useAgentStore.getState().activeThreadId;
        if (id) void openThread(id, false);
        return () => { sequence.current++; threadListRequest.current++; };
    }, [owner]);
    useEffect(() => {
        let refreshing = false, pending = false, listPending = false, disposed = false;
        const refresh = async (event: Event) => {
            const topic = (event as CustomEvent<string>).detail;
            if (topic && topic !== "all" && topic !== "assistant") return;
            pending = true;
            if (!topic || topic === "all") listPending = true;
            if (refreshing) return;
            refreshing = true;
            try { while (pending && !disposed) { pending = false; if (listPending) { listPending = false; await refreshThreads(); } const id = useAgentStore.getState().activeThreadId; if (id && !disposed) await openThread(id, false); } }
            catch (error) { if (!disposed) showError(error); }
            finally { refreshing = false; }
        };
        window.addEventListener("server-changed", refresh);
        return () => { disposed = true; window.removeEventListener("server-changed", refresh); };
    }, [owner]);
    const send = async () => {
        if (submittingRef.current || uploadingRef.current || editingDisabled) return;
        const draft = useAgentStore.getState();
        const { selectedSkill, selectionRevision } = useAgentSkillStore.getState();
        const text = draft.prompt.trim() ? draft.prompt : draft.attachments.length ? t("agent.eventMore.attachmentPrompt") : "";
        if (!text) return;
        const entry = modelEntry;
        if (!selected || !entry) { notify.warning(appI18n.t("workspace.selectAssistantModel")); return; }
        const destination = target;
        const assertSession = captureSession();
        if (draft.canvasReferences.some((reference) => reference.projectId !== destination)) { notify.warning(t("workspace.referencesProject")); return; }
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
            const clientId = destination && routeProject === destination && routeProjectRef.current === destination && context?.snapshot.projectId === destination ? context.clientId : undefined;
            await api.startTurn(thread.id, { prompt: text, projectId: destination || undefined, clientId, channelId: selected.channelId, modelId: entry.id, parameters, version: thread.version, skill: selectedSkill?.name, attachments: draft.attachments.map((item) => assetId(item.url) || ""), references: draft.canvasReferences.map((item) => item.nodeId) });
            assertSession();
            const current = useAgentStore.getState();
            const skillState = useAgentSkillStore.getState();
            if (current.prompt === draft.prompt && current.attachments === draft.attachments && current.canvasReferences === draft.canvasReferences && skillState.selectionRevision === selectionRevision) {
                useAgentStore.setState({ prompt: "", attachments: [], canvasReferences: [] });
                if (selectedSkill) skillState.clearSelection(selectionRevision);
            }
            await openThread(thread.id);
            if (!thread.title) void refreshThreads().catch(showError);
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
    const addFiles = async (files: FileList | File[] | null) => {
        if (!files?.length || uploadingRef.current || submittingRef.current || editingDisabled) return;
        const assertSession = captureSession();
        uploadingRef.current = true;
        setUploading(true);
        try {
            for (const file of Array.from(files)) {
                assertSession();
                const image = await uploadImage(file);
                assertSession();
                useAgentStore.setState((state) => ({ attachments: [...state.attachments, { id: nanoid(), name: file.name, type: image.mimeType, size: image.bytes, width: image.width, height: image.height, url: image.url, dataUrl: image.url }] }));
            }
        } catch (error) { showError(error); }
        finally { uploadingRef.current = false; setUploading(false); }
    };
    const listedThread = threads.find((thread) => thread.id === activeId);
    const currentThread = listedThread && listedThread.version >= (snapshot?.thread.version ?? 0) ? listedThread : snapshot?.thread;
    const title = currentThread?.title || t("agent.history.newThread");
    const showReasoning = modelEntry?.parameters.some((control) => control.key === "reasoning_effort" && !control.hidden && inputVisible(control, resolveModelParameters(config, selectedModel, modelParameters[selectedModel])));
    const dismissError = () => { setError(""); useAgentStore.setState({ connectError: "" }); };
    const reload = () => {
        const assertSession = captureSession();
        void refreshThreads().then(async () => {
            assertSession();
            dismissError();
            if (requestedThread.current) await openThread(requestedThread.current, false);
        }).catch(showError);
    };
    const renameThread = async (thread: api.AssistantThread, title: string) => {
        const assertSession = captureSession();
        try {
            const updated = await api.renameThread(thread.id, title, thread.version);
            assertSession();
            setSnapshot((current) => current?.thread.id === thread.id && current.thread.version === thread.version ? { ...current, thread: updated } : current);
        } catch (error) {
            if (error instanceof ApiError && error.code === "version_conflict") { reload(); throw new Error(t("agent.history.renameConflict")); }
            throw error;
        }
        setRenamingThread(null);
        reload();
    };
    const deleteThread = (thread: api.AssistantThread) => {
        const assertSession = captureSession();
        confirm({ title: t("agent.history.deleteTitle", { name: thread.title || t("agent.history.newThread") }), content: t("workspace.deleteConversationDescription"), confirmText: t("workspace.deleteConversation"), destructive: true, onConfirm: async () => {
            assertSession();
            await api.deleteThread(thread.id);
            assertSession();
            if (thread.id === requestedThread.current) clearThread();
            void refreshThreads().catch(showError);
        } });
    };
    return { activeId, threads, title, snapshot, running, reportedTurn, busy, editingDisabled, error, loading, loadingThreads, submitting, uploading, stopping, target, selectTarget, config, selectedModel, modelParameters, showReasoning, renamingThread, setRenamingThread,
        newThread, openThread, renameThread, deleteThread, reload, refreshHistory: () => void refreshThreads().catch(showError), dismissError, send, stop, addFiles };
}
