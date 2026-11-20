import appI18n from "@/i18n";
import { ArrowLeft, ArrowRight, BookOpen, CircleHelp, ClipboardPaste, Download, FolderPlus, PanelLeftClose, PanelLeftOpen, SlidersHorizontal, Sparkles, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { useWorkbenchDraft } from "@/hooks/use-workbench-draft";
import { useMediaQuery } from "@/hooks/use-media-query";
import { Notice } from "@/components/ui/display";
import { useFeedback } from "@/hooks/use-feedback";
import { Button } from "@/components/ui/button";
import { AnimatedSidePanel } from "@/components/ui/animated-side-panel";
import { WorkbenchHistory } from "@/components/workbench-history";

import { EmptyState as Empty } from "@/components/ui/display";
import { MediaPreview, type PreviewImage } from "@/components/ui/media-preview";
import { Textarea } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { Badge as Tag } from "@/components/ui/display";
import { Tooltip } from "@/components/ui/popover";
import { useTranslation } from "react-i18next";

import { useOpenModelSettings } from "@/hooks/use-open-model-settings";
import { ModelPicker } from "@/components/model-picker";
import { ModelParameters } from "@/components/model-parameters";
import { PromptSelectDialog } from "@/components/prompts/prompt-select-dialog";
import { AssetPickerModal, type InsertAssetPayload } from "@/components/canvas/asset-picker-modal";
import { imageReferenceLabel } from "@/lib/image-reference-prompt";
import { findChannelModel, resolveModelParameters, useConfigStore, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import { useAppUiStore } from "@/stores/use-app-ui-store";
import { nanoid } from "nanoid";
import { formatBytes, formatDuration, formatRatio } from "@/lib/image-utils";
import { requestEdit, requestGeneration } from "@/services/api/image";
import { GenerationProgress } from "@/components/generation-progress";
import { GenerationStateError, type GenerationOptions, type GenerationTask } from "@/services/api/tasks";
import { Link } from "react-router-dom";
import { ensureImagePreview, getImagePreviewRevision, previewUrlFor, resolveImageUrl, subscribeImagePreviews, uploadImage } from "@/services/image-storage";
import { useAssetStore } from "@/stores/use-asset-store";
import { useWorkbenchAgentStore } from "@/stores/use-workbench-agent-store";
import type { ReferenceImage } from "@/types/image";
import i18n from "@/i18n";
import { readWorkbenchRecords, saveWorkbenchRecord, deleteWorkbenchRecord } from "@/services/api/workbench-records";
import { ApiError, captureSession } from "@/services/api/client";
import { cn } from "@/lib/utils";
import { inputHelp, inputLabel, inputVisible } from "@/lib/model-inputs";

type GeneratedImage = {
    id: string;
    dataUrl: string;
    storageKey?: string;
    durationMs: number;
    width: number;
    height: number;
    bytes: number;
    mimeType?: string;
};

type GenerationResult = {
    id: string;
    status: "pending" | "success" | "failed" | "confirmation_required" | "disconnected";
    taskState?: GenerationTask;
    taskId?: string;
    image?: GeneratedImage;
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
    successCount: number;
    failCount: number;
    pendingCount?: number;
    taskIds?: string[];
    imageCount: number;
    status: "success" | "failed" | "confirmation_required";
    images: GeneratedImage[];
};

type GenerationLogConfig = Pick<AiConfig, "model" | "imageModel" | "modelParameters">;

export default function ImagePage() {
    const { notify, confirm } = useFeedback();
    const { t } = useTranslation();
    useSyncExternalStore(subscribeImagePreviews, getImagePreviewRevision);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const dragDepthRef = useRef(0);
    const resultRecordId = useRef("");
    const effectiveConfig = useEffectiveConfig();
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const openModelSettings = useOpenModelSettings();
    const addAsset = useAssetStore((state) => state.addAsset);
    const { recordId: draftRecordId, setRecordId, prompt, setPrompt, selectedModel, setSelectedModel, parameters, setParameters, references, setReferences, clearDraft, hydrated: draftReady, error: draftError, load: loadDraft, retrySave: retryDraftSave } = useWorkbenchDraft("image");
    const [results, setResults] = useState<GenerationResult[]>([]);
    const [logs, setLogs] = useState<GenerationLog[]>([]);
    const [logsError, setLogsError] = useState("");
    const [logsLoading, setLogsLoading] = useState(true);
    const runRef = useRef(false);
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
    const [isReferenceDragActive, setIsReferenceDragActive] = useState(false);
    const [autoRunToken, setAutoRunToken] = useState(0);
    const imageCommand = useWorkbenchAgentStore((state) => state.imageCommand);
    const clearImageCommand = useWorkbenchAgentStore((state) => state.clearImageCommand);
    const updateAgentTask = useWorkbenchAgentStore((state) => state.updateTask);
    const processedCommandRef = useRef(0);
    const agentTaskIdRef = useRef<string | undefined>(undefined);
    const assertSession = useRef(captureSession()).current;
    const initialModel = useRef("");

    if (draftReady && !initialModel.current && effectiveConfig.imageModel) initialModel.current = effectiveConfig.imageModel;
    const model = selectedModel ?? initialModel.current;
    const canGenerate = Boolean(prompt.trim());
    const controls = findChannelModel(effectiveConfig, model)?.model.parameters || [];
    const countControl = controls.find((control) => control.key === "count" && control.type === "number");
    const parameterValues = { ...(countControl ? { count: 1 } : {}), ...parameters[model] };
    const resolvedParameters = resolveModelParameters(effectiveConfig, model, parameterValues);
    const referenceHelp = controls.filter((control) => control.type === "reference" && inputVisible(control, resolvedParameters)).map((control) => [inputLabel(control), inputHelp(control)].filter(Boolean).join("\n")).join("\n\n");
    const singleResult = results.length === 1;
    const resultGallery = results.flatMap((result, index) => result.status === "success" && result.image ? [{ src: result.image.dataUrl, alt: t("imageWorkbench.resultAlt", { count: index + 1 }) }] : []);

    useEffect(() => { if (draftReady && selectedModel === null && model) setSelectedModel(model); }, [draftReady, selectedModel, model, setSelectedModel]);

    useEffect(() => {
        if (!running || !startedAt) return;
        const timer = window.setInterval(() => setElapsedMs(performance.now() - startedAt), 1000);
        return () => window.clearInterval(timer);
    }, [running, startedAt]);

    useEffect(() => {
        void refreshLogs();
    }, []);

    const addReferences = async (files?: FileList | null) => {
        if (!draftReady) return;
        assertSession();
        const imageFiles = Array.from(files || []).filter((file) => file.type.startsWith("image/"));
        const nextReferences = await Promise.all(
            imageFiles.map(async (file) => {
                const image = await uploadImage(file, { workbenchRecordId: draftRecordId });
                return { id: nanoid(), name: file.name, type: image.mimeType, dataUrl: image.url, storageKey: image.storageKey };
            }),
        );
        setReferences((value) => [...value, ...nextReferences]);
    };

    const addReferencesFromClipboard = async () => {
        if (!draftReady) return;
        try {
            assertSession();
            const items = await navigator.clipboard.read();
            const blobs = await Promise.all(items.flatMap((item) => item.types.filter((type) => type.startsWith("image/")).map((type) => item.getType(type))));
            if (!blobs.length) {
                notify.error(t("imageWorkbench.clipboardEmpty"));
                return;
            }
            const nextReferences = await Promise.all(
                blobs.map(async (blob, index) => {
                    assertSession();
                    const image = await uploadImage(blob, { workbenchRecordId: draftRecordId });
                    return { id: nanoid(), name: `clipboard-${index + 1}.png`, type: image.mimeType, dataUrl: image.url, storageKey: image.storageKey };
                }),
            );
            setReferences((value) => [...value, ...nextReferences]);
            notify.success(t("imageWorkbench.clipboardAdded", { count: nextReferences.length }));
        } catch {
            notify.error(t("imageWorkbench.clipboardEmpty"));
        }
    };

    const generate = async () => {
        if (!draftReady || runRef.current) return;
        const agentTaskId = agentTaskIdRef.current;
        agentTaskIdRef.current = undefined;
        const text = prompt.trim();
        if (!text) {
            notify.error(t("imageWorkbench.promptRequired"));
            if (agentTaskId) updateAgentTask(agentTaskId, { status: "failed", error: t("imageWorkbench.promptRequired") });
            return;
        }
        if (!isAiConfigReady(effectiveConfig, model)) {
            notify.warning(t("workbench.configFirst"));
            openModelSettings();
            if (agentTaskId) updateAgentTask(agentTaskId, { status: "failed", error: t("imageWorkbench.configIncomplete") });
            return;
        }

        const snapshot = buildRequestSnapshot();
        if (!snapshot) {
            if (agentTaskId) updateAgentTask(agentTaskId, { status: "failed", error: t("imageWorkbench.invalidParams") });
            return;
        }

        runRef.current = true;
        const recordId = draftRecordId;
        setRecordId(nanoid());
        setElapsedMs(0);
        setRunning(true);
        if (agentTaskId) updateAgentTask(agentTaskId, { status: "running", error: undefined });
        setPreviewLog(null);
        resultRecordId.current = recordId;
        const slot: GenerationResult = { id: nanoid(), status: "pending" };
        setResults([slot]);
        const requestStartedAt = performance.now();
        setStartedAt(requestStartedAt);
        let successImages: GeneratedImage[] = [];
        let failure: unknown;
        try { successImages = await runGenerationSlot(slot.id, snapshot, recordId); }
        catch (error) { failure = error; }
        try { assertSession(); } catch { return; }
        const successCount = successImages.length;
        const pending = failure instanceof GenerationStateError && ["confirmation_required", "disconnected"].includes(failure.status);
        const failCount = successCount || pending ? 0 : 1;
        const error = failure instanceof Error ? failure.message : failCount ? t("workbench.generationFailed") : undefined;
        if (agentTaskId) updateAgentTask(agentTaskId, { status: successCount ? "succeeded" : "failed", successCount, failCount, error: successCount ? undefined : error });

        try {
            await saveLog({
                ...buildLog({
                    id: recordId,
                    prompt: text,
                    model,
                    config: snapshot.config,
                    references: snapshot.references,
                    durationMs: performance.now() - requestStartedAt,
                    successCount,
                    failCount,
                    status: pending ? "confirmation_required" : successCount ? "success" : "failed",
                    images: successImages,
                }),
                pendingCount: pending ? 1 : 0,
                imageCount: successImages.length + failCount + (pending ? 1 : 0),
                taskIds: pending && failure instanceof GenerationStateError && failure.taskId ? [failure.taskId] : [],
            });
            pending ? notify.warning(t("workspace.confirmationRequired")) : successCount ? notify.success(t("imageWorkbench.generated")) : notify.error(error || t("workbench.generationFailed"));
        } catch (error) {
            if (!(error instanceof ApiError && error.code === "record_removed")) { const message = error instanceof Error ? error.message : t("workspace.saveRecordFailed"); setLogsError(message); notify.error(message); }
        } finally {
            runRef.current = false;
            setRunning(false);
        }
    };

    // Handle image-generation commands from the Agent panel by setting the prompt and optionally starting generation.
    useEffect(() => {
        if (!draftReady || !imageCommand || imageCommand.nonce === processedCommandRef.current) return;
        processedCommandRef.current = imageCommand.nonce;
        clearImageCommand();
        if (typeof imageCommand.prompt === "string") setPrompt(imageCommand.prompt);
        if (imageCommand.run && running) {
            if (imageCommand.taskId) updateAgentTask(imageCommand.taskId, { status: "failed", error: t("imageWorkbench.busy") });
            return;
        }
        if (imageCommand.run) {
            agentTaskIdRef.current = imageCommand.taskId;
            setAutoRunToken((value) => value + 1);
        }
    }, [draftReady, imageCommand, clearImageCommand, running, updateAgentTask]);

    useEffect(() => {
        if (!autoRunToken) return;
        void generate();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [autoRunToken]);

    const saveResultToAssets = async (image: GeneratedImage, index: number) => {
        const stored = await uploadImage(image.dataUrl);
        await addAsset({
            kind: "image",
            title: t("imageWorkbench.resultTitle", { count: index + 1 }),
            coverUrl: stored.url,
            source: t("imageWorkbench.source"),
            data: { dataUrl: stored.url, storageKey: stored.storageKey, width: stored.width, height: stored.height, bytes: stored.bytes, mimeType: stored.mimeType },
            metadata: { source: "image-page", prompt },
        });
        notify.success(t("common.addedToAssets"));
    };

    const insertPickedAsset = async (payload: InsertAssetPayload) => {
        if (payload.kind === "text") {
            setPrompt(payload.content);
        } else if (payload.kind === "image") {
            const stored = await uploadImage(payload.dataUrl);
            setReferences((value) => [...value, { id: nanoid(), name: payload.title, type: stored.mimeType, dataUrl: stored.url, storageKey: stored.storageKey }]);
        } else {
            notify.warning(t("imageWorkbench.unsupportedAsset"));
        }
        setAssetPickerOpen(false);
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
            const result = await deleteWorkbenchRecord("image", log);
            assertSession();
            setLogs((value) => value.filter((item) => item.id !== log.id));
            if (previewLog?.id === log.id || resultRecordId.current === log.id) { setPreviewLog(null); setResults([]); resultRecordId.current = ""; }
            else setResults((value) => value.filter((item) => !log.images.some((image) => image.id === item.image?.id)));
            notify.success(t(result.cleanupPending ? "workbench.recordCleanupPending" : "workbench.recordDeleted"));
        },
    });

    const saveLog = async (log: GenerationLog) => {
        assertSession();
        const saved = await saveWorkbenchRecord("image", serializeLog(log));
        await refreshLogs();
        return { ...log, recordVersion: saved.recordVersion };
    };

    const refreshLogs = async () => { setLogsLoading(true); try { const records = await readStoredLogs(); assertSession(); setLogs(records); setLogsError(""); } catch (error) { setLogsError(error instanceof Error ? error.message : appI18n.t("workspace.readRecordsFailed")); } finally { setLogsLoading(false); } };

    const previewGenerationLog = (log: GenerationLog) => {
        if (!draftReady) return;
        setPreviewLog(log);
        resultRecordId.current = log.id;
        setLogsOpen(false);
        setPrompt(log.prompt);
        setReferences(log.references || []);
        setParameters((state) => ({ ...state, [log.model]: log.config.modelParameters || {} }));
        setSelectedModel(log.model);
        setResults([...log.images.map((image): GenerationResult => ({ id: image.id, status: "success", image })), ...(log.taskIds || []).map((taskId): GenerationResult => ({ id: taskId, taskId, status: "confirmation_required", error: t("workspace.pendingOutcome") }))]);
    };

    const buildRequestSnapshot = () => {
        const text = prompt.trim();
        if (!text) {
            notify.error(t("imageWorkbench.promptRequired"));
            return null;
        }
        if (!isAiConfigReady(effectiveConfig, model)) {
            notify.warning(t("workbench.configFirst"));
            openModelSettings();
            return null;
        }
        return { text, config: { ...effectiveConfig, model, modelParameters: resolveModelParameters(effectiveConfig, model, parameterValues) }, references: [...references] };
    };

    const runGenerationSlot = async (slotId: string, snapshot: { text: string; config: AiConfig; references: ReferenceImage[] }, recordId: string) => {
        const itemStartedAt = performance.now();
        try {
            assertSession();
            const options: GenerationOptions = { workbenchRecordId: recordId, onTask: (taskState) => setResults((value) => updateResult(value, slotId, { taskState, taskId: taskState.id })) };
            const result = snapshot.references.length ? await requestEdit(snapshot.config, snapshot.text, snapshot.references, options) : await requestGeneration(snapshot.config, snapshot.text, options);
            if (!result.length) throw new Error(t("imageWorkbench.missingResult"));
            const images: GeneratedImage[] = [];
            for (const image of result) {
                const stored = await uploadImage(image.dataUrl);
                images.push({ id: image.id, dataUrl: stored.url, ...(stored.storageKey ? { storageKey: stored.storageKey } : {}), durationMs: performance.now() - itemStartedAt, width: stored.width, height: stored.height, bytes: stored.bytes, mimeType: stored.mimeType });
            }
            assertSession();
            setResults((value) => value.flatMap((slot) => slot.id === slotId ? images.map((image, index) => ({ id: index === 0 ? slotId : image.id, status: "success" as const, image })) : [slot]));
            return images;
        } catch (error) {
            const status = error instanceof GenerationStateError && ["confirmation_required", "disconnected"].includes(error.status) ? error.status as "confirmation_required" | "disconnected" : "failed";
            setResults((value) => updateResult(value, slotId, { status, error: error instanceof Error ? error.message : t("workbench.generationFailed") }));
            throw error;
        }
    };

    const retryResult = async (slotId: string) => {
        const snapshot = buildRequestSnapshot();
        if (!snapshot) return;
        setPreviewLog(null);
        setResults((value) => updateResult(value, slotId, { status: "pending", error: undefined, image: undefined, taskState: undefined, taskId: undefined }));
        const retryStartedAt = performance.now();
        const recordId = nanoid();
        let images: GeneratedImage[] = [];
        let failure: unknown;
        try { images = await runGenerationSlot(slotId, snapshot, recordId); }
        catch (error) { failure = error; }
        const pending = failure instanceof GenerationStateError && ["confirmation_required", "disconnected"].includes(failure.status);
        try {
            await saveLog({ ...buildLog({ id: recordId, prompt: snapshot.text, model, config: snapshot.config, references: snapshot.references, durationMs: performance.now() - retryStartedAt, successCount: images.length, failCount: images.length || pending ? 0 : 1, status: images.length ? "success" : pending ? "confirmation_required" : "failed", images }), imageCount: images.length || 1, pendingCount: pending ? 1 : 0, taskIds: pending && failure instanceof GenerationStateError && failure.taskId ? [failure.taskId] : [] });
            if (images.length) notify.success(t("workbench.retrySuccess"));
        } catch (error) {
            if (!(error instanceof ApiError && error.code === "record_removed")) { const message = error instanceof Error ? error.message : t("workspace.saveRecordFailed"); setLogsError(message); notify.error(message); }
        }
    };

    return (
        <div className="flex h-full flex-col overflow-hidden bg-background text-foreground">
            <main className="flex min-h-0 flex-1 overflow-hidden">
                <AnimatedSidePanel id="image-history-panel" open={desktop && historyPanelOpen} width="var(--secondary-sidebar-width)" panelClassName="thin-scrollbar min-h-0 overflow-y-auto border-r border-border bg-sidebar px-3 pb-4 pt-5 text-sidebar-foreground">
                    <WorkbenchHistory
                        kind="image"
                        unavailable={logsLoading || Boolean(logsError)}
                        logs={logs}
                        activeLogId={previewLog?.id}
                        onCreateSession={createSession}
                        onDeleteLog={deleteLog}
                        onPreviewLog={(log) => void previewGenerationLog(log)}
                    />
                </AnimatedSidePanel>

                <section className="grid min-h-0 min-w-0 flex-1 grid-cols-1 content-start overflow-y-auto xl:content-stretch xl:grid-cols-[360px_minmax(0,1fr)] xl:overflow-hidden 2xl:grid-cols-[420px_minmax(0,1fr)]">
                    <div className="thin-scrollbar flex min-w-0 flex-col px-4 pb-4 xl:min-h-0 xl:overflow-y-auto">
                        <header className="sticky top-0 z-10 -mx-4 flex h-16 shrink-0 items-center justify-between gap-2 bg-background pl-1 pr-4">
                            <div className="flex min-w-0 items-center gap-2">
                                <Tooltip title={t(historyVisible ? "workbench.collapseHistory" : "workbench.expandHistory")}>
                                    <Button variant="ghost" size="icon" className="size-7" onClick={toggleHistory} aria-label={t(historyVisible ? "workbench.collapseHistory" : "workbench.expandHistory")} aria-expanded={historyVisible} aria-controls={desktop ? "image-history-panel" : undefined}>
                                        {historyVisible ? <PanelLeftClose /> : <PanelLeftOpen />}
                                    </Button>
                                </Tooltip>
                                <h1 className="truncate text-lg font-semibold">{t("imageWorkbench.title")}</h1>
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
                                <Textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={7} placeholder={t("imageWorkbench.promptPlaceholder")} />
                            </div>

                            <div className="min-w-0">
                                <div className="mb-2 flex items-center justify-between gap-3">
                                    <span className="flex items-center gap-1 text-base font-semibold">{t("imageWorkbench.references")}{referenceHelp ? <Tooltip title={referenceHelp} clickable placement="top"><Button size="icon" variant="ghost" className="size-5 [&_svg]:size-3.5" aria-label={t("ui.parameterHelp", { name: t("imageWorkbench.references") })}><CircleHelp /></Button></Tooltip> : null}</span>
                                    <div className="flex gap-2">
                                        <Button size="sm" icon={<ClipboardPaste className="size-3.5" />} onClick={() => void addReferencesFromClipboard()}>
                                            {t("workbench.clipboard")}
                                        </Button>
                                        <Button size="sm" icon={<Upload className="size-3.5" />} onClick={() => fileInputRef.current?.click()}>
                                            {t("workbench.upload")}
                                        </Button>
                                    </div>
                                </div>
                                <div
                                    className={`hover-scrollbar hover-scrollbar-hint relative flex min-h-24 w-full min-w-0 max-w-full gap-2 overflow-x-scroll overflow-y-hidden rounded-lg border border-dashed p-2 pb-3 overscroll-x-contain transition-colors ${isReferenceDragActive ? "border-border bg-muted  " : "border-border "}`}
                                    onDragEnter={(event) => {
                                        event.preventDefault();
                                        dragDepthRef.current += 1;
                                        if (event.dataTransfer.types.includes("Files")) setIsReferenceDragActive(true);
                                    }}
                                    onDragOver={(event) => {
                                        event.preventDefault();
                                        event.dataTransfer.dropEffect = "copy";
                                    }}
                                    onDragLeave={(event) => {
                                        event.preventDefault();
                                        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
                                        if (!dragDepthRef.current) setIsReferenceDragActive(false);
                                    }}
                                    onDrop={(event) => {
                                        event.preventDefault();
                                        dragDepthRef.current = 0;
                                        setIsReferenceDragActive(false);
                                        void addReferences(event.dataTransfer.files);
                                    }}
                                    onWheel={(event) => {
                                        if (event.currentTarget.scrollWidth <= event.currentTarget.clientWidth) return;
                                        event.preventDefault();
                                        event.currentTarget.scrollLeft += event.deltaY;
                                    }}
                                >
                                    {references.map((item, index) => (
                                        <div key={item.id} className="group relative size-20 shrink-0 overflow-hidden rounded-md border border-border ">
                                            <img src={previewUrlFor(item.storageKey) || item.dataUrl} alt={item.name} className="size-full object-cover" />
                                            <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-xs font-medium text-white">{imageReferenceLabel(index)}</span>
                                            <ReferenceOrderButtons index={index} total={references.length} onMove={(offset) => setReferences((value) => moveListItem(value, index, offset))} />
                                            <Button
                                                variant="ghost" size="icon"
                                                className="absolute right-1 top-1 size-6 bg-popover/95 text-popover-foreground opacity-0 hover:bg-popover group-hover:opacity-100 focus-visible:opacity-100 [&_svg]:size-3.5"
                                                onClick={() => setReferences((value) => value.filter((ref) => ref.id !== item.id))}
                                                aria-label={t("imageWorkbench.removeReference")}
                                            >
                                                <Trash2 className="size-3.5" />
                                            </Button>
                                        </div>
                                    ))}
                                    {!references.length ? <div className="flex min-w-full items-center justify-center text-sm text-muted-foreground">{isReferenceDragActive ? t("imageWorkbench.dropReferences") : t("imageWorkbench.noReferences")}</div> : null}
                                </div>
                            </div>

                            <ModelParameters key={model} config={effectiveConfig} model={model} value={parameterValues} compact disabled={running} onChange={(value) => setParameters((state) => ({ ...state, [model]: value }))} />
                        </div>

                        <div className="mt-auto flex min-w-0 items-center justify-between gap-2 pt-6">
                            <ModelPicker config={effectiveConfig} value={model} onChange={setSelectedModel} capability="image" disabled={!draftReady || running} onMissingConfig={openModelSettings} className="min-w-0" />
                            <Button variant="default" className="shrink-0" icon={<Sparkles className="size-4" />} loading={running} disabled={!draftReady || !canGenerate || running} onClick={() => void generate()}>
                                {t("workbench.generate")}
                            </Button>
                        </div>
                    </div>

                    <div className="flex min-w-0 flex-col border-t border-border px-4 pb-4 xl:min-h-0 xl:overflow-hidden xl:border-l xl:border-t-0">
                        <div className="sticky top-0 z-10 -mx-4 flex h-16 shrink-0 items-center justify-between gap-3 bg-background px-4">
                            <div className="flex min-w-0 items-center gap-2">
                                <h2 className="text-base font-semibold">{t("workbench.results")}</h2>
                                {results.length > 1 ? <Tag className="shrink-0">{t("workbench.itemCount", { count: results.length })}</Tag> : null}
                            </div>
                            {running ? <Tag className="m-0 px-2 py-1">{t("workbench.waiting", { time: formatDuration(elapsedMs) })}</Tag> : null}
                        </div>
                        <div className="thin-scrollbar min-h-0 flex-1 xl:overflow-y-auto">
                            {results.length ? (
                                <div role="group" aria-label={t("imageWorkbench.resultGroup", { count: results.length })} className={cn("grid gap-4", singleResult ? "xl:h-full xl:grid-rows-[minmax(0,1fr)]" : "items-start [grid-template-columns:repeat(auto-fit,minmax(min(100%,18rem),1fr))]")}>
                                    {results.map((result, index) =>
                                        result.status === "success" && result.image ? (
                                            <ResultImageCard key={result.id} image={result.image} index={index} single={singleResult} gallery={resultGallery} onSaveAsset={saveResultToAssets} />
                                        ) : ["confirmation_required", "disconnected"].includes(result.status) ? (
                                            <div key={result.id} className={cn("flex aspect-square min-w-0 flex-col items-center justify-center gap-4 rounded-lg border border-warning/25 p-5", singleResult && "xl:h-full xl:aspect-auto")}><GenerationProgress task={{ ...result.taskState, status: result.status, error: result.error }} /><Link className="text-xs underline" to={`/tasks?taskId=${encodeURIComponent(result.taskId || "")}`}>{t("workspace.taskDetails")}</Link></div>
                                        ) : result.status === "failed" ? (
                                            <FailedImageCard key={result.id} single={singleResult} error={result.error || t("workbench.generationFailed")} onRetry={() => retryResult(result.id)} />
                                        ) : (
                                            <PendingImageCard key={result.id} single={singleResult} task={result.taskState} />
                                        ),
                                    )}
                                </div>
                            ) : (
                                <div className="flex min-h-[320px] flex-col items-center justify-center text-center lg:min-h-[480px]">
                                    <Empty description={t("imageWorkbench.empty")} />
                                </div>
                            )}
                        </div>
                    </div>
                </section>
            </main>
            <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(event) => {
                    void addReferences(event.target.files);
                    event.target.value = "";
                }}
            />
            <Dialog title={t("workbench.logs")} side="bottom" open={logsOpen} onClose={() => setLogsOpen(false)}>
                <WorkbenchHistory
                    kind="image"
                    unavailable={logsLoading || Boolean(logsError)}
                    logs={logs}
                    activeLogId={previewLog?.id}
                    onCreateSession={createSession}
                    onDeleteLog={deleteLog}
                    onPreviewLog={(log) => void previewGenerationLog(log)}
                />
            </Dialog>
            <Dialog title={t("workbench.settings")} side="bottom" className="h-[82dvh]" open={settingsOpen} onClose={() => setSettingsOpen(false)}>
                <div className="space-y-4" inert={!draftReady}>
                    <ModelParameters key={model} config={effectiveConfig} model={model} value={parameterValues} compact disabled={running} onChange={(value) => setParameters((state) => ({ ...state, [model]: value }))} />
                </div>
            </Dialog>
            <PromptSelectDialog open={promptDialogOpen} onOpenChange={setPromptDialogOpen} onSelect={setPrompt} initialType="image" />
            <AssetPickerModal open={assetPickerOpen} defaultTab="my-assets" onInsert={(payload) => void insertPickedAsset(payload)} onClose={() => setAssetPickerOpen(false)} />
        </div>
    );
}

function ResultImageCard({
    image,
    index,
    single,
    gallery,
    onSaveAsset,
}: {
    image: GeneratedImage;
    index: number;
    single: boolean;
    gallery: PreviewImage[];
    onSaveAsset: (image: GeneratedImage, index: number) => void;
}) {
    const { t } = useTranslation();
    useSyncExternalStore(subscribeImagePreviews, getImagePreviewRevision);
    return (
        <div className={cn("@container min-w-0 overflow-hidden rounded-lg border border-border bg-card text-card-foreground", single && "xl:flex xl:h-full xl:min-h-min xl:flex-col")}>
            <MediaPreview src={single ? image.dataUrl : previewUrlFor(image.storageKey) || image.dataUrl} previewSrc={image.dataUrl} alt={t("imageWorkbench.resultAlt", { count: index + 1 })} gallery={gallery} style={{ "--result-image-ratio": image.width > 0 && image.height > 0 ? `${image.width} / ${image.height}` : "1 / 1" } as CSSProperties} triggerClassName={cn("relative [aspect-ratio:var(--result-image-ratio)]", single && "xl:min-h-0 xl:flex-1 xl:aspect-auto")} className="absolute inset-0 size-full object-contain" />
            <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-3 py-2.5">
                <div className="flex min-w-0 items-center gap-2 whitespace-nowrap text-xs text-muted-foreground">
                    <Tooltip title={`${image.width} × ${image.height}`}><span className="shrink-0" tabIndex={0}>{formatRatio(image.width, image.height)}</span></Tooltip>
                    <span className="truncate">{formatBytes(image.bytes)}</span>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                    <Tooltip title={t("workbench.addToLibrary")}>
                        <Button size="sm" aria-label={t("workbench.addToLibrary")} icon={<FolderPlus className="size-3.5" />} onClick={() => void onSaveAsset(image, index)}>
                            <span className="hidden @min-[26rem]:inline">{t("workbench.addToLibrary")}</span>
                        </Button>
                    </Tooltip>
                    <Tooltip title={t("workbench.downloadLocal")}>
                        <Button asChild size="sm" aria-label={t("workbench.downloadLocal")}>
                            <a href={image.dataUrl} download><Download className="size-3.5" /><span className="hidden @min-[26rem]:inline">{t("workbench.downloadLocal")}</span></a>
                        </Button>
                    </Tooltip>
                </div>
            </div>
        </div>
    );
}

function PendingImageCard({ task, single }: { task?: GenerationTask; single: boolean }) {
    return (
        <div className={cn("relative aspect-square overflow-hidden rounded-lg border border-dashed border-border bg-card", single && "xl:h-full xl:aspect-auto")}>
            <div
                className="absolute inset-0 opacity-60"
                style={{
                    backgroundImage: "radial-gradient(circle, var(--border) 1.4px, transparent 1.6px)",
                    backgroundSize: "16px 16px",
                }}
            />
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground ">
                <GenerationProgress task={task} />
            </div>
        </div>
    );
}

function FailedImageCard({ error, onRetry, single }: { error: string; onRetry: () => void; single: boolean }) {
    const { t } = useTranslation();
    return (
        <div className={cn("flex min-w-0 flex-col overflow-hidden rounded-lg border border-destructive/25 bg-destructive/5", single && "xl:h-full")}>
            <div className={cn("flex aspect-square flex-col items-center justify-center gap-3 p-5 text-center", single && "xl:flex-1 xl:aspect-auto")}>
                <div className="text-sm font-medium text-destructive">{t("workbench.failed")}</div>
                <p className="!mb-0 !text-xs !text-destructive">
                    {error}
                </p>
            </div>
            <div className="flex shrink-0 justify-end border-t border-destructive/25 p-3">
                <Button variant="destructive" size="sm" onClick={onRetry}>
                    {t("workbench.retry")}
                </Button>
            </div>
        </div>
    );
}

function updateResult(results: GenerationResult[], id: string, next: Partial<GenerationResult>) {
    return results.map((item) => (item.id === id ? { ...item, ...next } : item));
}

async function readStoredLogs() {
    const records = await readWorkbenchRecords<GenerationLog>("image");
    return (await Promise.all(records.map(normalizeLog))).sort((a, b) => b.createdAt - a.createdAt);
}

async function normalizeLog(log: GenerationLog): Promise<GenerationLog> {
    const references = await Promise.all(
        log.references.map(async (item) => {
            void ensureImagePreview(item.storageKey);
            return { ...item, dataUrl: await resolveImageUrl(item.storageKey, item.dataUrl) };
        }),
    );
    const images = await Promise.all(
        log.images.map(async (item) => {
            void ensureImagePreview(item.storageKey);
            return { ...item, dataUrl: await resolveImageUrl(item.storageKey, item.dataUrl) };
        }),
    );
    return { ...log, references, images };
}

function serializeLog(log: GenerationLog): GenerationLog {
    return {
        ...log,
        references: log.references.map((item) => ({ ...item, dataUrl: item.storageKey ? "" : item.dataUrl })),
        images: log.images.map((image) => ({ ...image, dataUrl: image.storageKey ? "" : image.dataUrl })),
    };
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

function buildLog({
    id = nanoid(),
    prompt,
    model,
    config,
    references,
    durationMs,
    successCount,
    failCount,
    status,
    images,
}: {
    id?: string;
    prompt: string;
    model: string;
    config: GenerationLogConfig;
    references: ReferenceImage[];
    durationMs: number;
    successCount: number;
    failCount: number;
    status: GenerationLog["status"];
    images: GeneratedImage[];
}): GenerationLog {
    const logConfig = {
        model: config.model,
        modelParameters: config.modelParameters,
        imageModel: config.imageModel,
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
        successCount,
        failCount,
        imageCount: images.length + failCount,
        status,
        images,
    };
}
