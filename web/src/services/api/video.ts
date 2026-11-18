import i18n from "@/i18n";
import { assetUrl, getAsset } from "./assets";
import { createGeneration, GenerationStateError, getGeneration, waitForGeneration, type GenerationOptions } from "./tasks";
import { uploadMediaFile, type UploadedFile } from "@/services/file-storage";
import type { AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";
import { captureSession } from "./client";

type VideoMediaOptions = GenerationOptions & { videos?: ReferenceVideo[]; audios?: ReferenceAudio[] };
export type VideoGenerationResult = { assetId: string };
export type VideoGenerationTask = { id: string; provider: "server"; model: string };
export type VideoGenerationTaskState = { status: "pending"; error?: string; progress?: number; providerStatus?: string } | { status: "completed"; result: VideoGenerationResult } | { status: "failed" | "confirmation_required"; error: string };

export async function requestVideoGeneration(config: AiConfig, prompt: string, references: ReferenceImage[] = [], options?: VideoMediaOptions) {
    return waitForVideoGenerationTask(config, await createVideoGenerationTask(config, prompt, references, options), options);
}
export async function createVideoGenerationTask(config: AiConfig, prompt: string, references: ReferenceImage[] = [], options?: VideoMediaOptions): Promise<VideoGenerationTask> {
    const task = await createGeneration(config, "video", { prompt, references, videos: options?.videos, audios: options?.audios }, options);
    return { id: task.id, provider: "server", model: config.model || config.videoModel };
}
export async function waitForVideoGenerationTask(_config: AiConfig, task: VideoGenerationTask, options?: GenerationOptions): Promise<VideoGenerationResult> {
    const assertSession = captureSession();
    const record = await getGeneration(task.id, options?.signal);
    assertSession();
    const result = await waitForGeneration(record, options);
    if (!result.assetIds[0]) throw new Error(i18n.t("errors.videoNotSaved"));
    return { assetId: result.assetIds[0] };
}
export async function pollVideoGenerationTask(_config: AiConfig, task: VideoGenerationTask, options?: GenerationOptions): Promise<VideoGenerationTaskState> {
    const record = await getGeneration(task.id, options?.signal);
    if (record.status === "succeeded" && record.assetIds[0]) return { status: "completed", result: { assetId: record.assetIds[0] } };
    if (["failed", "cancelled", "interrupted"].includes(record.status)) return { status: "failed", error: record.error || i18n.t("errors.taskIncomplete") };
    if (record.status === "confirmation_required") return { status: "confirmation_required", error: record.error || i18n.t("errors.taskUnconfirmed") };
    return { status: "pending", progress: record.progress, providerStatus: record.providerStatus };
}
export function isVideoTaskFailed(error: unknown) { return error instanceof GenerationStateError && ["failed", "cancelled", "interrupted"].includes(error.status); }
export async function storeGeneratedVideo(result: VideoGenerationResult): Promise<UploadedFile> {
    const assertSession = captureSession();
    const asset = await getAsset(result.assetId);
    assertSession();
    if (asset.saveState !== "saved" || asset.deleteState) throw new Error(asset.deleteState ? i18n.t("errors.assetDeleted") : i18n.t("errors.videoUnreliable"));
    return uploadMediaFile(assetUrl(asset.id), "video");
}
