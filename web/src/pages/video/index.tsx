import appI18n from "@/i18n";
import { ArrowLeft, ArrowRight, BookOpen, CircleHelp, ClipboardPaste, Download, FolderPlus, PanelLeftClose, PanelLeftOpen, SlidersHorizontal, Sparkles, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore, type DragEvent } from "react";
import { useWorkbenchDraft } from "@/hooks/use-workbench-draft";
import { useMediaQuery } from "@/hooks/use-media-query";
import { Notice } from "@/components/ui/display";
import { useFeedback } from "@/hooks/use-feedback";
import { Button } from "@/components/ui/button";
import { AnimatedSidePanel } from "@/components/ui/animated-side-panel";
import { WorkbenchHistory } from "@/components/workbench-history";

import { EmptyState as Empty } from "@/components/ui/display";
import { Textarea } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { Badge as Tag } from "@/components/ui/display";
import { Tooltip } from "@/components/ui/popover";
import { nanoid } from "nanoid";
import { useTranslation } from "react-i18next";

import { useOpenModelSettings } from "@/hooks/use-open-model-settings";
import { AssetPickerModal, type InsertAssetPayload } from "@/components/canvas/asset-picker-modal";
import { ModelPicker } from "@/components/model-picker";
import { ModelInputFields, ModelParameters } from "@/components/model-parameters";
import { PromptSelectDialog } from "@/components/prompts/prompt-select-dialog";
import { formatBytes, formatDuration } from "@/lib/image-utils";
import { resolveMediaUrl, uploadMediaFile } from "@/services/file-storage";
import { AssetMedia } from "@/components/canvas/asset-media";
import { resolveImageUrl, ensureImagePreview, getImagePreviewRevision, previewUrlFor, subscribeImagePreviews, uploadImage } from "@/services/image-storage";
import { createVideoGenerationTask, waitForVideoGenerationTask, isVideoTaskFailed, storeGeneratedVideo, type VideoGenerationTask } from "@/services/api/video";
import { GenerationProgress } from "@/components/generation-progress";
import { GenerationStateError, type GenerationTask } from "@/services/api/tasks";
import { Link } from "react-router-dom";
import { ApiError, captureSession } from "@/services/api/client";
import { useAssetStore } from "@/stores/use-asset-store";
import { useWorkbenchAgentStore } from "@/stores/use-workbench-agent-store";
import { findChannelModel, resolveModelParameters, useConfigStore, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import { useAppUiStore } from "@/stores/use-app-ui-store";
import type { ReferenceImage } from "@/types/image";
import i18n from "@/i18n";
import { readWorkbenchRecords, saveWorkbenchRecord, deleteWorkbenchRecord } from "@/services/api/workbench-records";
import { assetId } from "@/services/api/assets";
import { inputHelp, inputLabel, inputVisible } from "@/lib/model-inputs";
import { keyframeModeInput } from "./video-modes";

type GeneratedVideo = {
    id: string;
    url: string;
    storageKey: string;
    durationMs: number;
    width: number;
    height: number;
    bytes: number;
    mimeType: string;
};

type GenerationResult = {
    id: string;
    status: "pending" | "success" | "failed" | "confirmation_required" | "disconnected";
    taskState?: GenerationTask;
    taskId?: string;
    video?: GeneratedVideo;
    error?: string;
};

type GenerationLog = {
    recordVersion?: number;
    id: string;
    createdAt: number;
    title: string;
    prompt: string;
    time: string;
    model: string;
    config: GenerationLogConfig;
    references: ReferenceImage[];
    durationMs: number;
    status: "pending" | "success" | "failed" | "confirmation_required" | "disconnected";
    task?: VideoGenerationTask;
    video?: GeneratedVideo;
    error?: string;
};

type GenerationLogConfig = Pick<AiConfig, "model" | "videoModel" | "modelParameters">;

export default function VideoPage() {
    const { notify, confirm } = useFeedback();
    const { t } = useTranslation();
    useSyncExternalStore(subscribeImagePreviews, getImagePreviewRevision);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const dragDepthRef = useRef(0);
    const resultRecordId = useRef("");
    const activeLogIdsRef = useRef<Set<string>>(new Set());
    const effectiveConfig = useEffectiveConfig();
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const openModelSettings = useOpenModelSettings();
    const addAsset = useAssetStore((state) => state.addAsset);
    const { recordId: draftRecordId, setRecordId, prompt, setPrompt, selectedModel, setSelectedModel, parameters, setParameters, referenceModes, setReferenceModes, references, setReferences, clearDraft, hydrated: draftReady, error: draftError, load: loadDraft, retrySave: retryDraftSave } = useWorkbenchDraft("video");
    const [results, setResults] = useState<GenerationResult[]>([]);
    const [logs, setLogs] = useState<GenerationLog[]>([]);
    const [logsError, setLogsError] = useState("");
    const [logsLoading, setLogsLoading] = useState(true);
    const submittingRef = useRef(false);
    const [running, setRunning] = useState(false);
    const [logsOpen, setLogsOpen] = useState(false);
    const historyPanelOpen = useAppUiStore((state) => state.workbenchHistoryOpen);
    const toggleHistoryPanel = useAppUiStore((state) => state.toggleWorkbenchHistory);
    const desktop = useMediaQuery("(min-width: 1024px)");
    const historyVisible = desktop ? historyPanelOpen : logsOpen;
    const toggleHistory = () => desktop ? toggleHistoryPanel() : setLogsOpen((open) => !open);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [promptDialogOpen, setPromptDialogOpen] = useState(false);
    const [assetPickerOpen, setAssetPickerOpen] = useState(false);
    const [startedAt, setStartedAt] = useState(0);
    const [elapsedMs, setElapsedMs] = useState(0);
    const [previewLog, setPreviewLog] = useState<GenerationLog | null>(null);
    const [referenceDragTarget, setReferenceDragTarget] = useState(false);
    const [autoRunToken, setAutoRunToken] = useState(0);
    const videoCommand = useWorkbenchAgentStore((state) => state.videoCommand);
    const clearVideoCommand = useWorkbenchAgentStore((state) => state.clearVideoCommand);
    const updateAgentTask = useWorkbenchAgentStore((state) => state.updateTask);
    const processedCommandRef = useRef(0);
    const agentTaskIdRef = useRef<string | undefined>(undefined);
    const assertSession = useRef(captureSession()).current;
    const watching = useRef(new Map<string, AbortController>());

    useEffect(() => () => { watching.current.forEach((controller) => controller.abort()); }, []);

    const initialModel = useRef("");
    if (draftReady && !initialModel.current && effectiveConfig.videoModel) initialModel.current = effectiveConfig.videoModel;
    const model = selectedModel ?? initialModel.current;
    const canGenerate = Boolean(prompt.trim());
    const controls = findChannelModel(effectiveConfig, model)?.model.parameters || [];
    const resolvedParameters = resolveModelParameters(effectiveConfig, model, parameters[model]);
    const keyframeMode = keyframeModeInput(controls, resolvedParameters);
    const referenceMode = referenceModes[model] || (references.length || !keyframeMode?.options?.some((option) => option.value === "text") ? "reference" : "text");
    const displayedMode = resolvedParameters.keyframe === "none" || resolvedParameters.keyframe == null ? referenceMode : resolvedParameters.keyframe;
    const updateMode = (value: Record<string, unknown>) => {
        const next = String(value.workbench_mode);
        if (next === "text" || next === "reference") setReferenceModes((state) => ({ ...state, [model]: next }));
        setParameters((state) => ({ ...state, [model]: { ...state[model], keyframe: next === "text" || next === "reference" ? "none" : next } }));
    };
    const hasMaterials = controls.some((control) => control.type === "reference" || control.type === "asset");
    const materialControls = controls.filter((control) => (control.type === "reference" || control.type === "asset") && inputVisible(control, resolvedParameters) && (!keyframeMode || displayedMode !== "text" && (displayedMode === "reference" || control.role === "image")));
    const referenceAccept = [...new Set(materialControls.flatMap((control) => control.mimeTypes?.length ? control.mimeTypes : [`${control.role}/*`]))].join(",");
    const acceptsReference = (type: string) => materialControls.some((control) => type.startsWith(`${control.role}/`) && (!control.mimeTypes?.length || control.mimeTypes.some((mime) => mime.endsWith("/*") ? type.startsWith(mime.slice(0, -1)) : mime === type)));
    const visibleReferences = references.filter((reference) => materialControls.some((control) => reference.type.startsWith(`${control.role}/`)));
    const referenceHelp = materialControls.map((control) => [inputLabel(control), inputHelp(control)].filter(Boolean).join("\n")).join("\n\n");
    const updateParameters = (value: Record<string, unknown>) => setParameters((state) => ({ ...state, [model]: value }));
    const appendReferences = (items: ReferenceImage[]) => {
        setReferences((value) => [...value, ...items]);
        setParameters((state) => {
            const next = { ...state[model] }, available = [...items];
            const resolved = resolveModelParameters(effectiveConfig, model, next);
            for (const control of controls) {
                if (control.type !== "asset" || control.hidden || !inputVisible(control, resolved) || resolved[control.key]) continue;
                const index = available.findIndex((reference) => reference.type.startsWith(`${control.role}/`));
                if (index < 0) continue;
                const reference = available.splice(index, 1)[0], id = assetId(reference.storageKey) || assetId(reference.dataUrl);
                if (id) next[control.key] = `asset:${id}`;
            }
            return { ...state, [model]: next };
        });
    };
    const removeReference = (reference: ReferenceImage) => {
        setReferences((value) => value.filter((item) => item.id !== reference.id));
        const id = assetId(reference.storageKey) || assetId(reference.dataUrl);
        setParameters((state) => ({ ...state, [model]: Object.fromEntries(Object.entries(state[model] || {}).map(([key, value]) => [key, id && controls.some((control) => control.key === key && control.type === "asset") && typeof value === "string" && assetId(value) === id ? null : value])) }));
    };
    const moveReference = (id: string, offset: number) => {
        const target = visibleReferences[visibleReferences.findIndex((reference) => reference.id === id) + offset];
        if (target) setReferences((value) => { const index = value.findIndex((reference) => reference.id === id); return moveListItem(value, index, value.findIndex((reference) => reference.id === target.id) - index); });
    };

    useEffect(() => { if (draftReady && selectedModel === null && model) setSelectedModel(model); }, [draftReady, selectedModel, model, setSelectedModel]);

    useEffect(() => {
        if (!running || !startedAt) return;
        const timer = window.setInterval(() => setElapsedMs(performance.now() - startedAt), 1000);
        return () => window.clearInterval(timer);
    }, [running, startedAt]);

    useEffect(() => {
        void refreshLogs().catch((error: unknown) => notify.error(error instanceof Error ? error.message : appI18n.t("workspace.readRecordsFailed")));
    }, []);

    const addReferences = async (files?: FileList | null) => {
        if (!draftReady || running) return;
        try {
        assertSession();
        const selectedFiles = Array.from(files || []);
        const unsupported = selectedFiles.filter((file) => !acceptsReference(file.type));
        if (unsupported.length) notify.warning(t("videoWorkbench.referenceTypeUnsupported"));
        const uploads = await Promise.allSettled(selectedFiles.filter((file) => acceptsReference(file.type)).map((file) => uploadReference(file, file.name, undefined, draftRecordId)));
        assertSession();
        const nextReferences = uploads.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
        appendReferences(nextReferences);
        for (const result of uploads) if (result.status === "rejected") notify.error(result.reason instanceof Error ? result.reason.message : t("errors.mediaNotSaved"));
        } catch (error) { notify.error(error instanceof Error ? error.message : t("errors.mediaNotSaved")); }
    };

    const handleReferenceDragEnter = (event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        dragDepthRef.current += 1;
        if (event.dataTransfer.types.includes("Files")) setReferenceDragTarget(true);
    };

    const handleReferenceDragLeave = (event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
        if (!dragDepthRef.current) setReferenceDragTarget(false);
    };

    const handleReferenceDrop = (event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        dragDepthRef.current = 0;
        setReferenceDragTarget(false);
        void addReferences(event.dataTransfer.files);
    };

    const addReferencesFromClipboard = async () => {
        if (!draftReady || running) return;
        try {
            assertSession();
            const items = await navigator.clipboard.read();
            const blobs = await Promise.all(items.flatMap((item) => item.types.filter((type) => type.startsWith("image/") && acceptsReference(type)).map((type) => item.getType(type))));
            if (!blobs.length) {
                notify.error(t("videoWorkbench.clipboardEmpty"));
                return;
            }
            const nextReferences = await Promise.all(
                blobs.map(async (blob, index) => {
                    assertSession();
                    const image = await uploadImage(blob, { workbenchRecordId: draftRecordId });
                    return { id: nanoid(), name: `clipboard-${index + 1}.png`, type: image.mimeType, dataUrl: image.url, storageKey: image.storageKey };
                }),
            );
            assertSession();
            appendReferences(nextReferences);
            notify.success(t("videoWorkbench.clipboardAdded", { count: nextReferences.length }));
        } catch {
            notify.error(t("videoWorkbench.clipboardEmpty"));
        }
    };
    const generate = async () => {
        if (!draftReady || submittingRef.current || running) return;
        const agentTaskId = agentTaskIdRef.current;
        agentTaskIdRef.current = undefined;
        const snapshot = buildRequestSnapshot();
        if (!snapshot) {
            if (agentTaskId) updateAgentTask(agentTaskId, { status: "failed", error: t("videoWorkbench.invalidParams") });
            return;
        }
        submittingRef.current = true;
        setElapsedMs(0);
        setRunning(true);
        if (agentTaskId) updateAgentTask(agentTaskId, { status: "running", error: undefined });
        setPreviewLog(null);
        setResults([{ id: nanoid(), status: "pending" }]);
        const batchStartedAt = performance.now();
        setStartedAt(batchStartedAt);
        let submitted: GenerationLog | undefined;
        const recordId = draftRecordId;
        setRecordId(nanoid());
        resultRecordId.current = recordId;
        try {
            assertSession();
            const task = await createVideoGenerationTask(snapshot.config, snapshot.text, snapshot.references, { workbenchRecordId: recordId });
            const log = buildLog({ id: recordId, prompt: snapshot.text, model, config: snapshot.config, references: snapshot.references, durationMs: 0, status: "pending", task });
            setResults([{ id: log.id, taskId: task.id, status: "pending" }]);
            submitted = log;
            const saved = await saveLog(log, false);
            void pollGenerationLog(saved, snapshot.config, agentTaskId);
        } catch (error) {
            if (submitted) {
                if (error instanceof ApiError && error.code === "record_removed") { setRunning(false); return; }
                notify.error(appI18n.t("workspace.taskSubmittedRecordFailed"));
                setResults([{ id: submitted.id, taskId: submitted.task?.id, status: "disconnected", error: appI18n.t("workspace.taskSubmittedRecordFailed") }]);
                setRunning(false);
                return;
            }
            const errorMessage = error instanceof Error ? error.message : t("workbench.generationFailed");
            setResults([{ id: nanoid(), status: "failed", error: errorMessage }]);
            if (agentTaskId) updateAgentTask(agentTaskId, { status: "failed", successCount: 0, failCount: 1, error: errorMessage });
            try { await saveLog(buildLog({ id: recordId, prompt: snapshot.text, model, config: snapshot.config, references: snapshot.references, durationMs: performance.now() - batchStartedAt, status: "failed", error: errorMessage })); }
            catch (saveError) { if (!(saveError instanceof ApiError && saveError.code === "record_removed")) setLogsError(saveError instanceof Error ? saveError.message : appI18n.t("workspace.saveRecordFailed")); }
            notify.error(errorMessage);
            setRunning(false);
        } finally { submittingRef.current = false; }
    };

    // Handle video-generation commands from the Agent panel by setting the prompt and optionally starting generation.
    useEffect(() => {
        if (!draftReady || !videoCommand || videoCommand.nonce === processedCommandRef.current) return;
        processedCommandRef.current = videoCommand.nonce;
        clearVideoCommand();
        if (typeof videoCommand.prompt === "string") setPrompt(videoCommand.prompt);
        if (videoCommand.run && running) {
            if (videoCommand.taskId) updateAgentTask(videoCommand.taskId, { status: "failed", error: t("videoWorkbench.busy") });
            return;
        }
        if (videoCommand.run) {
            agentTaskIdRef.current = videoCommand.taskId;
            setAutoRunToken((value) => value + 1);
        }
    }, [draftReady, videoCommand, clearVideoCommand, running, updateAgentTask]);

    useEffect(() => {
        if (!autoRunToken) return;
        void generate();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [autoRunToken]);

    const buildRequestSnapshot = () => {
        const text = prompt.trim();
        if (!text) {
            notify.error(t("videoWorkbench.promptRequired"));
            return null;
        }
        if (!isAiConfigReady(effectiveConfig, model)) {
            notify.warning(t("workbench.configFirst"));
            openModelSettings();
            return null;
        }
        const activeReferences = references.filter((reference) => materialControls.some((control) => reference.type.startsWith(`${control.role}/`) && (control.type === "reference" || typeof resolvedParameters[control.key] === "string" && assetId(resolvedParameters[control.key] as string) === (assetId(reference.storageKey) || assetId(reference.dataUrl)))));
        return { text, config: { ...effectiveConfig, model, modelParameters: resolvedParameters }, references: activeReferences };
    };

    const retryResult = () => {
        void generate();
    };

    const saveResultToAssets = async (video: GeneratedVideo) => {
        await addAsset({
            kind: "video",
            title: t("videoWorkbench.resultTitle"),
            coverUrl: "",
            source: t("videoWorkbench.source"),
            data: { url: video.url, storageKey: video.storageKey, width: video.width, height: video.height, bytes: video.bytes, mimeType: video.mimeType },
            metadata: { source: "video-page", prompt },
        });
        notify.success(t("common.addedToAssets"));
    };

    const insertPickedAsset = async (payload: InsertAssetPayload) => {
        try {
        assertSession();
        if (payload.kind === "text") {
            setPrompt(payload.content);
        } else if (!materialControls.some((control) => control.role === payload.kind)) {
            notify.warning(t("videoWorkbench.referenceTypeUnsupported"));
            return;
        } else if (payload.kind === "image") {
            const stored = await uploadImage(payload.dataUrl);
            assertSession();
            appendReferences([{ id: nanoid(), name: payload.title, type: stored.mimeType, dataUrl: stored.url, storageKey: stored.storageKey }]);
        } else {
            const reference = await uploadReference(payload.storageKey || payload.url, payload.title, payload.kind);
            assertSession();
            appendReferences([reference]);
        }
        setAssetPickerOpen(false);
        } catch (error) { notify.error(error instanceof Error ? error.message : t("errors.mediaNotSaved")); }
    };

    const createSession = () => {
        if (!draftReady) return;
        clearDraft();
        initialModel.current = "";
        setResults([]);
        setElapsedMs(0);
        setStartedAt(0);
        setPreviewLog(null);
        resultRecordId.current = "";
    };

    const deleteLog = (log: GenerationLog) => confirm({
        title: t("workbench.deleteLogs"), content: t("workbench.deleteLogConfirm"), confirmText: t("common.delete"), destructive: true,
        onConfirm: async () => {
            const result = await deleteWorkbenchRecord("video", log);
            assertSession();
            watching.current.get(log.id)?.abort();
            setLogs((value) => value.filter((item) => item.id !== log.id));
            if (previewLog?.id === log.id || resultRecordId.current === log.id) { setPreviewLog(null); setResults([]); resultRecordId.current = ""; }
            notify.success(t(result.cleanupPending ? "workbench.recordCleanupPending" : "workbench.recordDeleted"));
        },
    });

    const saveLog = async (log: GenerationLog, resumePending = true) => {
        assertSession();
        const saved = await saveWorkbenchRecord("video", serializeLog(log));
        await refreshLogs(resumePending);
        return { ...log, recordVersion: saved.recordVersion };
    };

    const refreshLogs = async (resumePending = true) => {
        setLogsLoading(true);
        try {
        const nextLogs = await readStoredLogs();
        assertSession();
        setLogs(nextLogs);
        setLogsError("");
        if (resumePending) resumePendingLogs(nextLogs);
        return nextLogs;
        } catch (error) { setLogsError(error instanceof Error ? error.message : appI18n.t("workspace.readRecordsFailed")); return []; }
        finally { setLogsLoading(false); }
    };

    const resumePendingLogs = (items: GenerationLog[]) => {
        for (const log of items) {
            if (["pending", "confirmation_required", "disconnected"].includes(log.status) && log.task) void pollGenerationLog(log);
        }
    };

    const pollGenerationLog = async (log: GenerationLog, configOverride?: AiConfig, agentTaskId?: string) => {
        if (!log.task || activeLogIdsRef.current.has(log.id)) return;
        activeLogIdsRef.current.add(log.id);
        const controller = new AbortController();
        watching.current.set(log.id, controller);
        setRunning(true);
        setStartedAt((value) => value || performance.now());
        setResults((value) => (value.length ? value : [{ id: log.id, status: "pending" }]));
        const taskConfig = { ...effectiveConfig, ...log.config, model: log.task.model || log.model };
        const saveOutcome = async (next: GenerationLog) => {
            try { await saveLog(next, false); }
            catch (error) { if (!(error instanceof ApiError && error.code === "record_removed")) { const message = error instanceof Error ? error.message : t("workspace.saveRecordFailed"); setLogsError(message); notify.error(message); } }
        };
        try {
            const stored = await storeGeneratedVideo(await waitForVideoGenerationTask(configOverride || taskConfig, log.task, { signal: controller.signal, onTask: (taskState) => {
                setResults((value) => value.map((item) => item.id === log.id ? { ...item, status: "pending", taskId: taskState.id, taskState, error: undefined } : item));
            } }));
            if (controller.signal.aborted) return;
            const nextVideo: GeneratedVideo = { id: nanoid(), url: stored.url, storageKey: stored.storageKey, durationMs: stored.durationMs || 0, width: stored.width || 0, height: stored.height || 0, bytes: stored.bytes, mimeType: stored.mimeType };
            setResults((value) => value.map((item) => item.id === log.id ? { id: log.id, status: "success", video: nextVideo } : item));
            if (agentTaskId) updateAgentTask(agentTaskId, { status: "succeeded", successCount: 1, failCount: 0, error: undefined });
            await saveOutcome({ ...log, status: "success", durationMs: Date.now() - log.createdAt, video: nextVideo, error: undefined });
            if (!controller.signal.aborted) notify.success(t("videoWorkbench.generated"));
        } catch (error) {
            if (controller.signal.aborted) return;
            const errorMessage = error instanceof Error ? error.message : t("workbench.generationFailed");
            if (error instanceof GenerationStateError && error.status === "confirmation_required") {
                setResults((value) => value.map((item) => item.id === log.id ? { ...item, taskId: log.task!.id, status: "confirmation_required", error: errorMessage } : item));
                if (log.status !== "confirmation_required" || log.error !== errorMessage) await saveOutcome({ ...log, status: "confirmation_required", durationMs: Date.now() - log.createdAt, error: errorMessage });
                notify.warning(errorMessage);
                return;
            }
            if (!isVideoTaskFailed(error)) {
                setResults((value) => value.map((item) => item.id === log.id ? { ...item, taskId: log.task!.id, status: "disconnected", error: errorMessage } : item));
                if (log.status !== "disconnected" || log.error !== errorMessage) await saveOutcome({ ...log, status: "disconnected", durationMs: Date.now() - log.createdAt, error: errorMessage });
                notify.warning(errorMessage);
                return;
            }
            setResults((value) => value.map((item) => item.id === log.id ? { id: log.id, status: "failed", error: errorMessage } : item));
            if (agentTaskId) updateAgentTask(agentTaskId, { status: "failed", successCount: 0, failCount: 1, error: errorMessage });
            await saveOutcome({ ...log, status: "failed", durationMs: Date.now() - log.createdAt, error: errorMessage });
            notify.error(errorMessage);
        } finally {
            activeLogIdsRef.current.delete(log.id);
            watching.current.delete(log.id);
            if (!activeLogIdsRef.current.size) {
                setRunning(false);
                setStartedAt(0);
            }
        }
    };

    const previewGenerationLog = (log: GenerationLog) => {
        if (!draftReady) return;
        setPreviewLog(log);
        resultRecordId.current = log.id;
        setLogsOpen(false);
        setPrompt(log.prompt);
        setParameters((state) => ({ ...state, [log.model]: log.config.modelParameters || {} }));
        setReferences(log.references || []);
        setReferenceModes((state) => ({ ...state, [log.model]: log.references.length ? "reference" : "text" }));
        setSelectedModel(log.model);
        setResults(log.video ? [{ id: log.video.id, status: "success", video: log.video }] : [{ id: log.id, status: log.status, taskId: log.task?.id, error: log.error }]);
        if (log.task && ["pending", "confirmation_required", "disconnected"].includes(log.status)) void pollGenerationLog(log);
    };

    return (
        <div className="flex h-full flex-col overflow-hidden bg-background text-foreground">
            <main className="flex min-h-0 flex-1 overflow-hidden">
                <AnimatedSidePanel id="video-history-panel" open={desktop && historyPanelOpen} width="var(--secondary-sidebar-width)" panelClassName="thin-scrollbar min-h-0 overflow-y-auto border-r border-border bg-sidebar px-3 pb-4 pt-5 text-sidebar-foreground">
                    <WorkbenchHistory kind="video" unavailable={logsLoading || Boolean(logsError)} logs={logs} activeLogId={previewLog?.id} onCreateSession={createSession} onDeleteLog={deleteLog} onPreviewLog={previewGenerationLog} />
                </AnimatedSidePanel>

                <section className="grid min-h-0 min-w-0 flex-1 grid-cols-1 content-start overflow-y-auto xl:content-stretch xl:grid-cols-[360px_minmax(0,1fr)] xl:overflow-hidden 2xl:grid-cols-[420px_minmax(0,1fr)]">
                    <div className="thin-scrollbar flex min-w-0 flex-col px-4 pb-4 xl:min-h-0 xl:overflow-y-auto">
                        <header className="sticky top-0 z-10 -mx-4 flex h-16 shrink-0 items-center justify-between gap-2 bg-background pl-1 pr-4">
                            <div className="flex min-w-0 items-center gap-2">
                                <Tooltip title={t(historyVisible ? "workbench.collapseHistory" : "workbench.expandHistory")}>
                                    <Button variant="ghost" size="icon" className="size-7" onClick={toggleHistory} aria-label={t(historyVisible ? "workbench.collapseHistory" : "workbench.expandHistory")} aria-expanded={historyVisible} aria-controls={desktop ? "video-history-panel" : undefined}>
                                        {historyVisible ? <PanelLeftClose /> : <PanelLeftOpen />}
                                    </Button>
                                </Tooltip>
                                <h1 className="truncate text-lg font-semibold">{t("videoWorkbench.title")}</h1>
                            </div>
                            <Button variant="outline" size="icon" className="lg:hidden" icon={<SlidersHorizontal />} title={t("workbench.settings")} aria-label={t("workbench.settings")} onClick={() => setSettingsOpen(true)} />
                        </header>
                        {logsError ? <Notice type="error" className="mb-4 shrink-0" title={logsError} action={<Button onClick={() => void refreshLogs()}>{t("workspace.retryRead")}</Button>} /> : logsLoading ? <p role="status" className="mb-4 shrink-0 text-xs text-muted-foreground">{t("ui.loading")}</p> : null}
                        {draftError ? <Notice type="error" className="mb-4 shrink-0" title={draftError} action={<Button onClick={() => draftReady ? retryDraftSave() : void loadDraft()}>{t(draftReady ? "workspace.retrySave" : "workspace.retryRead")}</Button>} /> : !draftReady ? <p role="status" className="mb-4 text-xs text-muted-foreground">{t("ui.loading")}</p> : null}
                        <div className="space-y-5" inert={!draftReady}>
                            <div>
                                <div className="mb-2 flex items-center justify-between gap-3">
                                    <span className="text-base font-semibold">{t("workbench.prompt")}</span>
                                    <div className="flex gap-2">
                                        <Button size="sm" icon={<BookOpen className="size-3.5" />} onClick={() => setPromptDialogOpen(true)}>
                                            {t("workbench.viewPrompts")}
                                        </Button>
                                        <Button size="sm" icon={<FolderPlus className="size-3.5" />} onClick={() => setAssetPickerOpen(true)}>
                                            {t("workbench.viewAssets")}
                                        </Button>
                                    </div>
                                </div>
                                <Textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={7} placeholder={t("videoWorkbench.promptPlaceholder")} />
                            </div>

                            {hasMaterials ? <div className="min-w-0">
                                <div className="mb-2 flex items-center justify-between gap-3">
                                    <span className="flex items-center gap-1 text-base font-semibold">{t("videoWorkbench.references")}{referenceHelp ? <Tooltip title={referenceHelp} clickable placement="top"><Button variant="ghost" size="icon" className="size-5 [&_svg]:size-3.5" aria-label={t("ui.parameterHelp", { name: t("videoWorkbench.references") })}><CircleHelp /></Button></Tooltip> : null}</span>
                                    <div className="flex gap-2">
                                        <Button size="sm" disabled={running || !materialControls.some((control) => control.role === "image")} icon={<ClipboardPaste className="size-3.5" />} onClick={() => void addReferencesFromClipboard()}>
                                            {t("workbench.clipboard")}
                                        </Button>
                                        <Button size="sm" disabled={running || !materialControls.length} icon={<Upload className="size-3.5" />} onClick={() => fileInputRef.current?.click()}>
                                            {t("workbench.upload")}
                                        </Button>
                                    </div>
                                </div>
                                <div
                                    className={`hover-scrollbar hover-scrollbar-hint flex min-h-24 w-full min-w-0 max-w-full gap-2 overflow-x-scroll overflow-y-hidden rounded-lg border border-dashed p-2 pb-3 overscroll-x-contain transition-colors ${referenceDragTarget ? "border-border bg-muted  " : "border-border "}`}
                                    onDragEnter={handleReferenceDragEnter}
                                    onDragOver={(event) => {
                                        event.preventDefault();
                                        event.dataTransfer.dropEffect = "copy";
                                    }}
                                    onDragLeave={handleReferenceDragLeave}
                                    onDrop={handleReferenceDrop}
                                >
                                    {visibleReferences.map((item, index) => (
                                        <div key={item.id} className="group relative size-20 shrink-0 overflow-hidden rounded-md border border-border ">
                                            <AssetMedia kind={item.type.startsWith("video/") ? "video" : item.type.startsWith("audio/") ? "audio" : "image"} src={item.type.startsWith("image/") ? previewUrlFor(item.storageKey) || item.dataUrl : item.dataUrl} alt={item.name} controls={item.type.startsWith("audio/")} className="size-full object-cover" />
                                            <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-xs font-medium text-white">{index + 1}</span>
                                            <ReferenceOrderButtons index={index} total={visibleReferences.length} onMove={(offset) => moveReference(item.id, offset)} />
                                            <Button variant="ghost" size="icon" className="absolute right-1 top-1 size-6 bg-popover/95 text-popover-foreground opacity-0 hover:bg-popover group-hover:opacity-100 focus-visible:opacity-100 [&_svg]:size-3.5" onClick={() => removeReference(item)} aria-label={t("videoWorkbench.removeImage")}>
                                                <Trash2 className="size-3.5" />
                                            </Button>
                                        </div>
                                    ))}
                                    {!visibleReferences.length ? <div className="flex min-w-full items-center justify-center text-sm text-muted-foreground">{!materialControls.length ? t("videoWorkbench.noReferencesNeeded") : referenceDragTarget ? t("videoWorkbench.dropReferences") : t("videoWorkbench.noImages")}</div> : null}
                                </div>
                            </div> : null}
                            {keyframeMode ? <ModelInputFields key={`${model}:mode`} controls={[keyframeMode]} value={{ workbench_mode: displayedMode }} compact disabled={running} onChange={updateMode} /> : <ModelParameters key={`${model}:mode`} config={effectiveConfig} model={model} value={parameters[model]} compact section="mode" disabled={running} onChange={updateParameters} />}
                            <ModelParameters key={`${model}:parameters`} config={effectiveConfig} model={model} value={parameters[model]} compact section="parameters" references={visibleReferences} disabled={running} onChange={updateParameters} />
                        </div>

                        <div className="mt-auto flex min-w-0 items-center justify-between gap-2 pt-6">
                            <ModelPicker config={effectiveConfig} value={model} onChange={setSelectedModel} capability="video" disabled={!draftReady || running} onMissingConfig={openModelSettings} className="min-w-0" />
                            <Button variant="default" className="shrink-0" icon={<Sparkles className="size-4" />} loading={running} disabled={!draftReady || !canGenerate || running} onClick={() => void generate()}>
                                {t("workbench.generate")}
                            </Button>
                        </div>
                    </div>

                    <div className="thin-scrollbar min-w-0 border-t border-border px-4 pb-4 xl:min-h-0 xl:overflow-y-auto xl:border-l xl:border-t-0">
                        <div className="sticky top-0 z-10 -mx-4 flex h-16 items-center justify-between gap-3 bg-background px-4">
                            <h2 className="text-base font-semibold">{t("workbench.results")}</h2>
                            {running ? <Tag className="m-0 px-2 py-1">{t("workbench.waiting", { time: formatDuration(elapsedMs) })}</Tag> : null}
                        </div>
                        {results.length ? (
                            <div className="grid gap-4">
                                {results.map((result) => (result.status === "success" && result.video ? <ResultVideoCard key={result.id} video={result.video} onSaveAsset={saveResultToAssets} /> : ["confirmation_required", "disconnected"].includes(result.status) ? <div key={result.id} className="flex aspect-video flex-col items-center justify-center gap-4 rounded-lg border border-warning/25 p-5"><GenerationProgress task={{ ...result.taskState, status: result.status, error: result.error }} /><div className="flex gap-3"><Button variant="ghost" size="sm" disabled={running} onClick={() => void refreshLogs()}>{t("workspace.reload")}</Button><Link className="self-center text-xs underline" to={`/tasks?taskId=${encodeURIComponent(result.taskId || "")}`}>{t("workspace.taskDetails")}</Link></div></div> : result.status === "failed" ? <FailedVideoCard key={result.id} error={result.error || t("workbench.generationFailed")} onRetry={retryResult} /> : <PendingVideoCard key={result.id} task={result.taskState} />))}
                            </div>
                        ) : (
                            <div className="flex min-h-[320px] flex-col items-center justify-center text-center lg:min-h-[480px]">
                                
                                <Empty description={t("videoWorkbench.empty")} />
                            </div>
                        )}
                    </div>
                </section>
            </main>
            <input
                ref={fileInputRef}
                type="file"
                accept={referenceAccept}
                multiple
                className="hidden"
                onChange={(event) => {
                    void addReferences(event.target.files);
                    event.target.value = "";
                }}
            />
            <Dialog title={t("workbench.logs")} side="bottom" open={logsOpen} onClose={() => setLogsOpen(false)}>
                <WorkbenchHistory kind="video" unavailable={logsLoading || Boolean(logsError)} logs={logs} activeLogId={previewLog?.id} onCreateSession={createSession} onDeleteLog={deleteLog} onPreviewLog={previewGenerationLog} />
            </Dialog>
            <Dialog title={t("workbench.settings")} side="bottom" className="h-[82dvh]" open={settingsOpen} onClose={() => setSettingsOpen(false)}>
                <div className="space-y-4" inert={!draftReady}>
                    {keyframeMode ? <ModelInputFields key={`${model}:mode`} controls={[keyframeMode]} value={{ workbench_mode: displayedMode }} compact disabled={running} onChange={updateMode} /> : <ModelParameters key={`${model}:mode`} config={effectiveConfig} model={model} value={parameters[model]} compact section="mode" disabled={running} onChange={updateParameters} />}
                    <ModelParameters key={`${model}:parameters`} config={effectiveConfig} model={model} value={parameters[model]} compact section="parameters" references={visibleReferences} disabled={running} onChange={updateParameters} />
                </div>
            </Dialog>
            <PromptSelectDialog open={promptDialogOpen} onOpenChange={setPromptDialogOpen} onSelect={setPrompt} initialType="video" />
            <AssetPickerModal open={assetPickerOpen} defaultTab="my-assets" onInsert={(payload) => void insertPickedAsset(payload)} onClose={() => setAssetPickerOpen(false)} />
        </div>
    );
}

function ResultVideoCard({ video, onSaveAsset }: { video: GeneratedVideo; onSaveAsset: (video: GeneratedVideo) => void }) {
    const { t } = useTranslation();
    return (
        <div className="@container overflow-hidden rounded-lg border border-border bg-card text-card-foreground">
            <video src={video.url} controls preload="none" className="aspect-video w-full bg-black object-contain" />
            <div className="flex items-center justify-between gap-3 border-t border-border px-3 py-2.5">
                <div className="flex min-w-0 items-center gap-2 whitespace-nowrap text-xs text-muted-foreground">
                    <span className="truncate">
                        {video.width}x{video.height}
                    </span>
                    <span className="truncate">{formatBytes(video.bytes)}</span>
                    <span className="truncate">{formatDuration(video.durationMs)}</span>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                    <Tooltip title={t("workbench.addToLibrary")}>
                        <Button size="sm" aria-label={t("workbench.addToLibrary")} icon={<FolderPlus className="size-3.5" />} onClick={() => onSaveAsset(video)}>
                            <span className="hidden @min-[26rem]:inline">{t("workbench.addToLibrary")}</span>
                        </Button>
                    </Tooltip>
                    <Tooltip title={t("workbench.downloadLocal")}>
                        <Button asChild size="sm" aria-label={t("workbench.downloadLocal")}>
                            <a href={video.url} download><Download className="size-3.5" /><span className="hidden @min-[26rem]:inline">{t("workbench.downloadLocal")}</span></a>
                        </Button>
                    </Tooltip>
                </div>
            </div>
        </div>
    );
}

function PendingVideoCard({ task }: { task?: GenerationTask }) {
    return (
        <div className="relative aspect-video overflow-hidden rounded-lg border border-dashed border-border bg-card">
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground ">
                <GenerationProgress task={task} />
            </div>
        </div>
    );
}

function FailedVideoCard({ error, onRetry }: { error: string; onRetry: () => void }) {
    const { t } = useTranslation();
    return (
        <div className="overflow-hidden rounded-lg border border-destructive/25 bg-destructive/5">
            <div className="flex aspect-video flex-col items-center justify-center gap-3 p-5 text-center">
                <div className="text-sm font-medium text-destructive">{t("workbench.failed")}</div>
                <p className="!mb-0 !text-xs !text-destructive">
                    {error}
                </p>
            </div>
            <div className="flex justify-end border-t border-destructive/25 p-3">
                <Button variant="destructive" size="sm" onClick={onRetry}>
                    {t("workbench.retry")}
                </Button>
            </div>
        </div>
    );
}

async function readStoredLogs() {
    const records = await readWorkbenchRecords<GenerationLog>("video");
    return (await Promise.all(records.map(normalizeLog))).sort((a, b) => b.createdAt - a.createdAt);
}

async function normalizeLog(log: GenerationLog): Promise<GenerationLog> {
    const video = log.video?.storageKey ? { ...log.video, url: await resolveMediaUrl(log.video.storageKey, log.video.url) } : log.video;
    const references = await Promise.all(
        log.references.map(async (item) => {
            if (item.type.startsWith("image/")) { void ensureImagePreview(item.storageKey); return { ...item, dataUrl: await resolveImageUrl(item.storageKey, item.dataUrl) }; }
            return { ...item, dataUrl: await resolveMediaUrl(item.storageKey, item.dataUrl) };
        }),
    );
    return { ...log, references, video };
}

function serializeLog(log: GenerationLog): GenerationLog {
    return {
        ...log,
        references: log.references.map((item) => ({ ...item, dataUrl: item.storageKey ? "" : item.dataUrl })),
        video: log.video?.storageKey ? { ...log.video, url: "" } : log.video,
    };
}

async function uploadReference(input: string | Blob, name: string, kind?: "video" | "audio", recordId?: string): Promise<ReferenceImage> {
    if (input instanceof Blob && input.type.startsWith("image/")) { const stored = await uploadImage(input, { workbenchRecordId: recordId }); return { id: nanoid(), name, type: stored.mimeType, dataUrl: stored.url, storageKey: stored.storageKey }; }
    const stored = await uploadMediaFile(input, kind, recordId);
    return { id: nanoid(), name, type: stored.mimeType, dataUrl: stored.url, storageKey: stored.storageKey };
}

function moveListItem<T>(items: T[], index: number, offset: number) {
    const targetIndex = index + offset;
    if (targetIndex < 0 || targetIndex >= items.length) return items;
    const next = [...items];
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
    return next;
}

function ReferenceOrderButtons({ index, total, onMove }: { index: number; total: number; onMove: (offset: number) => void }) {
    useTranslation();
    if (total <= 1) return null;
    return (
        <div className="absolute inset-x-1 bottom-1 flex justify-between">
            <Button size="sm" className="!h-6 !w-6 !min-w-6 !rounded-full !bg-popover/95 !p-0 !shadow-sm" icon={<ArrowLeft className="size-3" />} disabled={index <= 0} onClick={() => onMove(-1)} />
            <Button size="sm" className="!h-6 !w-6 !min-w-6 !rounded-full !bg-popover/95 !p-0 !shadow-sm" icon={<ArrowRight className="size-3" />} disabled={index >= total - 1} onClick={() => onMove(1)} />
        </div>
    );
}

function buildLog({ id = nanoid(), prompt, model, config, references, durationMs, status, task, video, error }: { id?: string; prompt: string; model: string; config: AiConfig; references: ReferenceImage[]; durationMs: number; status: GenerationLog["status"]; task?: VideoGenerationTask; video?: GeneratedVideo; error?: string }): GenerationLog {
    const logConfig = {
        model: config.model,
        modelParameters: config.modelParameters,
        videoModel: config.videoModel,
    };
    return {
        id,
        createdAt: Date.now(),
        title: prompt.slice(0, 12) || i18n.t("workbench.untitled"),
        prompt,
        time: new Date().toLocaleString(i18n.resolvedLanguage, { hour12: false }),
        model,
        config: logConfig,
        references,
        durationMs,
        status,
        task,
        video,
        error,
    };
}

