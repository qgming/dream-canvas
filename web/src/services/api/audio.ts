import { assetUrl } from "./assets";
import { createGeneration, waitForGeneration, type GenerationOptions } from "./tasks";
import { uploadMediaFile, type UploadedFile } from "@/services/file-storage";
import type { AiConfig } from "@/stores/use-config-store";

export type AudioGenerationResult = { assetId: string };

export async function requestAudioGeneration(config: AiConfig, prompt: string, options?: GenerationOptions): Promise<AudioGenerationResult> {
    const task = await waitForGeneration(await createGeneration(config, "audio", { prompt }, options), options);
    if (!task.assetIds[0]) throw new Error("任务尚无可靠保存的音频原件");
    return { assetId: task.assetIds[0] };
}
export async function storeGeneratedAudio(result: AudioGenerationResult, _format = "mp3"): Promise<UploadedFile> { return uploadMediaFile(assetUrl(result.assetId), "audio"); }
