import i18n from "@/i18n";
import { apiRequest, captureSession, jsonRequest } from "./client";
import { assetId } from "./assets";
import { decodeChannelModel, type AiConfig, type ModelCapability } from "@/stores/use-config-store";
import type { AiTextMessage } from "./image";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";

export type GenerationTask = { id: string; projectId?: string; nodeId?: string; projectVersion: number; channelId: string; modelId: string; capability: ModelCapability; input: Record<string, unknown>; status: string; error?: string; text: string; assetIds: string[]; upstreamId?: string; saveState: string; syncState: string; cancelRequested: boolean; createdAt: string; updatedAt: string };
export class GenerationStateError extends Error {
    constructor(readonly status: string, message: string) { super(message); this.name = "GenerationStateError"; }
}
export type GenerationOptions = { signal?: AbortSignal; projectId?: string; nodeId?: string; projectVersion?: number };
type GenerationInput = { prompt?: string; messages?: AiTextMessage[]; references?: ReferenceImage[]; videos?: ReferenceVideo[]; audios?: ReferenceAudio[] };
export async function createGeneration(config: AiConfig, capability: ModelCapability, input: GenerationInput, options?: GenerationOptions) {
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
    const parameters: Record<string, unknown> = { quality: config.quality, size: config.size, count: config.count, background: config.background, reasoningEffort: config.reasoningEffort, seconds: config.videoSeconds, resolution: config.vquality, generateAudio: config.videoGenerateAudio, watermark: config.videoWatermark, mode: config.videoMode, voice: config.audioVoice, format: config.audioFormat, speed: config.audioSpeed, instructions: config.audioInstructions, systemPrompt: config.systemPrompt };
    for (const control of model.parameters) {
        const value = config.modelParameters && Object.prototype.hasOwnProperty.call(config.modelParameters, control.key) ? config.modelParameters[control.key] : control.default;
        if (value === undefined || value === null || (typeof value === "string" && !value.trim())) { if (control.required) throw new Error(i18n.t("errors.parameterRequired", { name: control.label })); parameters[control.key] = null; continue; }
        parameters[control.key] = value;
        if (control.type === "asset") {
            if (typeof value === "string" && value.startsWith("deleted-asset:")) throw new Error(i18n.t("errors.parameterAssetDeleted", { name: control.label }));
            const id = typeof value === "string" ? assetId(value) : undefined;
            if (!id || !control.role) throw new Error(i18n.t("errors.parameterAssetRequired", { name: control.label }));
            parameters[control.key] = id;
            if (!references.some((reference) => reference.assetId === id && reference.role === control.role)) references.push({ assetId: id, role: control.role });
        }
    }
    return apiRequest<GenerationTask>("/tasks", { ...jsonRequest("POST", { channelId: decoded.channelId, modelId: model.id, capability, prompt: input.prompt, messages, references, parameters, projectId: options?.projectId, nodeId: options?.nodeId, projectVersion: options?.projectVersion }), signal: options?.signal });
}
export const getGeneration = (id: string, signal?: AbortSignal) => apiRequest<GenerationTask>(`/tasks/${encodeURIComponent(id)}`, { signal });
export const listGenerations = () => apiRequest<GenerationTask[]>("/tasks");
export const cancelGeneration = (id: string) => apiRequest<GenerationTask>(`/tasks/${encodeURIComponent(id)}/cancel`, { method: "POST" });
export async function waitForGeneration(task: GenerationTask, options?: GenerationOptions & { onText?: (text: string) => void }): Promise<GenerationTask> {
    const assertSession = captureSession();
    return new Promise((resolve, reject) => {
        let text = "";
        let source: EventSource | undefined;
        const stop = () => { source?.close(); options?.signal?.removeEventListener("abort", abort); };
        const abort = () => { stop(); reject(new DOMException(i18n.t("errors.waitStopped"), "AbortError")); };
        const receive = (record: GenerationTask) => {
            try { assertSession(); } catch (error) { stop(); reject(error); return true; }
            if (record.text !== text) { options?.onText?.(record.text); text = record.text; }
            if (record.status === "succeeded") { stop(); resolve(record); return true; }
            if (["failed", "cancelled", "interrupted", "confirmation_required"].includes(record.status)) { stop(); reject(new GenerationStateError(record.status, record.error || i18n.t("errors.taskNotCompleted"))); return true; }
            return false;
        };
        if (options?.signal?.aborted) { abort(); return; }
        if (receive(task)) return;
        options?.signal?.addEventListener("abort", abort, { once: true });
        source = new EventSource(`/api/tasks/${encodeURIComponent(task.id)}/events`);
        source.addEventListener("snapshot", (event) => { try { receive(JSON.parse((event as MessageEvent<string>).data) as GenerationTask); } catch { stop(); reject(new Error(i18n.t("errors.taskStateFailed"))); } });
        source.onerror = () => { stop(); reject(new Error(i18n.t("errors.taskDisconnected"))); };
    });
}
