import i18n from "@/i18n";
import { apiRequest, captureSession, jsonRequest } from "./client";
import { assetId } from "./assets";
import { decodeChannelModel, resolveModelParameters, type AiConfig, type ModelCapability } from "@/stores/use-config-store";
import type { AiTextMessage } from "./image";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { inputLabel, inputVisible } from "@/lib/model-inputs";
import { useGenerationProgressStore } from "@/stores/use-generation-progress-store";

export type GenerationTask = { id: string; projectId?: string; workbenchRecordId?: string; nodeId?: string; projectVersion: number; channelId: string; modelId: string; capability: ModelCapability; input: Record<string, unknown>; status: string; providerStatus?: string; progress?: number; error?: string; text: string; assetIds: string[]; upstreamId?: string; queryRecoveredBy?: string; queryRecoveredAt?: string; saveState: string; syncState: string; responseCleanupPending: boolean; responseCleanupError?: string; cancelRequested: boolean; cancelError?: string; applied: boolean; appliedVersion: number; applyError?: string; usageState: string; debugRevision?: number; createdAt: string; updatedAt: string };
export class GenerationStateError extends Error {
    constructor(readonly status: string, message: string, readonly taskId?: string) { super(message); this.name = "GenerationStateError"; }
}
export type GenerationOptions = { signal?: AbortSignal; projectId?: string; workbenchRecordId?: string; nodeId?: string; projectVersion?: number; resultSlotId?: string; batchId?: string; onTask?: (task: GenerationTask) => void };
type GenerationInput = { prompt?: string; messages?: AiTextMessage[]; references?: ReferenceImage[]; videos?: ReferenceVideo[]; audios?: ReferenceAudio[] };
const submittedTasks = new WeakMap<AbortSignal, Set<string>>();
const cancelledSignals = new WeakSet<AbortSignal>();
export async function cancelGenerationsForSignal(signal: AbortSignal) {
    cancelledSignals.add(signal);
    await Promise.all([...(submittedTasks.get(signal) || [])].map(cancelGeneration));
}
export async function createGeneration(config: AiConfig, capability: ModelCapability, input: GenerationInput, options?: GenerationOptions) {
    if (options?.signal?.aborted) throw new DOMException(i18n.t("errors.waitStopped"), "AbortError");
    const selected = config.model || (capability === "image" ? config.imageModel : capability === "video" ? config.videoModel : capability === "audio" ? config.audioModel : config.textModel);
    const decoded = decodeChannelModel(selected);
    const model = config.channels.find((channel) => channel.id === decoded?.channelId)?.models.find((model) => model.name === decoded?.model);
    if (!decoded || !model || model.capability !== capability) throw new Error(i18n.t("errors.validChannelModel"));
    const references = [...(input.references || []), ...(input.videos || []), ...(input.audios || [])].map((reference) => {
        if (reference.storageKey?.startsWith("deleted-asset:") || ("dataUrl" in reference ? reference.dataUrl : reference.url)?.startsWith("deleted-asset:")) throw new Error(i18n.t("errors.referenceDeleted"));
        const id = assetId(reference.storageKey) || assetId("dataUrl" in reference ? reference.dataUrl : reference.url);
        if (!id) throw new Error(i18n.t("errors.uploadReferences"));
        return { assetId: id, role: reference.type.startsWith("image/") ? "image" : reference.type.startsWith("audio/") ? "audio" : "video" };
    });
    const messages = input.messages?.map((message) => ({ ...message, content: typeof message.content === "string" ? message.content : message.content.map((part) => {
        if (part.type !== "image_url") return part;
        const id = assetId(part.image_url.url);
        if (!id) throw new Error(i18n.t("errors.uploadMessageImages"));
        if (!references.some((reference) => reference.assetId === id)) references.push({ assetId: id, role: "image" });
        return { type: "image_asset" as const, assetId: id };
    }) }));
    for (const key of Object.keys(config.modelParameters || {})) {
        if (!model.parameters.some((control) => control.type !== "reference" && control.key === key)) throw new Error(i18n.t("errors.undeclaredParameter", { name: key }));
    }
    const parameters = resolveModelParameters(config, selected, config.modelParameters);
    for (const control of model.parameters) {
        if (control.type === "reference" || !inputVisible(control, parameters)) continue;
        const value = parameters[control.key];
        if (value === undefined || value === null || (typeof value === "string" && !value.trim())) { if (control.required) throw new Error(i18n.t("errors.parameterRequired", { name: inputLabel(control) })); parameters[control.key] = null; continue; }
        parameters[control.key] = value;
        if (control.type === "asset") {
            if (typeof value === "string" && value.startsWith("deleted-asset:")) throw new Error(i18n.t("errors.parameterAssetDeleted", { name: control.label }));
            const id = typeof value === "string" ? assetId(value) : undefined;
            if (!id || !control.role) throw new Error(i18n.t("errors.parameterAssetRequired", { name: control.label }));
            parameters[control.key] = id;
            if (!references.some((reference) => reference.assetId === id && reference.role === control.role)) references.push({ assetId: id, role: control.role });
        }
    }
    // Complete the acceptance request even if the page leaves, so a returned task ID is retained.
    const task = await apiRequest<GenerationTask>("/tasks", jsonRequest("POST", { channelId: decoded.channelId, modelId: model.id, capability, prompt: input.prompt, messages, references, parameters, projectId: options?.projectId, workbenchRecordId: options?.workbenchRecordId, nodeId: options?.nodeId, projectVersion: options?.projectVersion, resultSlotId: options?.resultSlotId, batchId: options?.batchId }));
    useGenerationProgressStore.getState().receive(task);
    if (options?.signal) { const ids = submittedTasks.get(options.signal) || new Set<string>(); ids.add(task.id); submittedTasks.set(options.signal, ids); if (cancelledSignals.has(options.signal)) await cancelGeneration(task.id); }
    return task;
}
export const getGeneration = (id: string, signal?: AbortSignal) => apiRequest<GenerationTask>(`/tasks/${encodeURIComponent(id)}`, { signal });
export const listGenerations = () => apiRequest<GenerationTask[]>("/tasks");
export const cancelGeneration = (id: string) => apiRequest<GenerationTask>(`/tasks/${encodeURIComponent(id)}/cancel`, { method: "POST" });
export const resumeGeneration = (id: string) => apiRequest<GenerationTask>(`/tasks/${encodeURIComponent(id)}/resume`, { method: "POST" });
export const recoverGenerationQuery = (task: GenerationTask, upstreamId: string) => apiRequest<GenerationTask>(`/admin/tasks/${encodeURIComponent(task.id)}/recover-query`, jsonRequest("POST", { upstreamId, expectedUpdatedAt: task.updatedAt, confirmed: true }));
export async function waitForGeneration(task: GenerationTask, options?: GenerationOptions & { onText?: (text: string) => void }): Promise<GenerationTask> {
    const assertSession = captureSession();
    return new Promise((resolve, reject) => {
        let text = "";
        let latest = task;
        let source: EventSource | undefined;
        let unsubscribe: (() => void) | undefined;
        let finishing = false;
        const stop = () => { source?.close(); unsubscribe?.(); options?.signal?.removeEventListener("abort", abort); };
        const abort = () => { finishing = true; stop(); reject(new DOMException(i18n.t("errors.waitStopped"), "AbortError")); };
        const receive = (record: GenerationTask) => {
            if (finishing) return true;
            if (Date.parse(record.updatedAt) < Date.parse(latest.updatedAt)) return false;
            try { assertSession(); } catch (error) { stop(); reject(error); return true; }
            latest = record;
            if (useGenerationProgressStore.getState().tasks[record.id] !== record) useGenerationProgressStore.getState().receive(record);
            options?.onTask?.(record);
            if (record.text !== text) { options?.onText?.(record.text); text = record.text; }
            if (record.status === "succeeded") {
                if (finishing) return true;
                finishing = true; stop();
                void (async () => {
                    if (record.projectId && record.nodeId) {
                        if (!record.applied) throw new GenerationStateError("project_conflict", record.applyError || i18n.t("errors.projectVersionChanged"));
                        await useCanvasStore.getState().acceptTaskVersion(record.id, record.projectId, record.nodeId);
                    }
                    assertSession();
                    if (options?.signal?.aborted) throw new DOMException(i18n.t("errors.waitStopped"), "AbortError");
                    resolve(record);
                })().catch(reject);
                return true;
            }
            if (["failed", "cancelled", "interrupted", "confirmation_required"].includes(record.status)) {
                if (finishing) return true;
                finishing = true; stop();
                void (async () => {
                    if (record.applied && record.projectId && record.nodeId) await useCanvasStore.getState().acceptTaskVersion(record.id, record.projectId, record.nodeId);
                    assertSession();
                    if (options?.signal?.aborted) throw new DOMException(i18n.t("errors.waitStopped"), "AbortError");
                    throw new GenerationStateError(record.status, record.error || i18n.t("errors.taskNotCompleted"), record.id);
                })().catch(reject);
                return true;
            }
            return false;
        };
        if (options?.signal?.aborted) { abort(); return; }
        if (receive(task)) return;
        options?.signal?.addEventListener("abort", abort, { once: true });
        if (task.projectId && task.nodeId) {
            unsubscribe = useGenerationProgressStore.subscribe((state) => { const record = state.tasks[task.id]; if (record) receive(record); });
            const current = useGenerationProgressStore.getState().tasks[task.id]; if (current) receive(current);
            return;
        }
        source = new EventSource(`/api/tasks/${encodeURIComponent(task.id)}/events`);
        source.onopen = () => { void getGeneration(task.id, options?.signal).then((record) => { if (!finishing) receive(record); }).catch(() => undefined); };
        source.addEventListener("snapshot", (event) => { try { receive(JSON.parse((event as MessageEvent<string>).data) as GenerationTask); } catch { stop(); reject(new GenerationStateError("disconnected", i18n.t("errors.taskStateFailed"), task.id)); } });
        source.onerror = () => {
            if (finishing) return;
            try { assertSession(); } catch (error) { stop(); reject(error); return; }
            const disconnected = { ...latest, status: "disconnected", error: i18n.t("errors.taskDisconnected") };
            useGenerationProgressStore.getState().receive(disconnected); options?.onTask?.(disconnected);
            if (source?.readyState === EventSource.CLOSED) { stop(); reject(new GenerationStateError("disconnected", disconnected.error, task.id)); }
        };
    });
}
