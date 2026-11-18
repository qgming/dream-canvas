import i18n from "@/i18n";
import { createGeneration, waitForGeneration, type GenerationOptions } from "./tasks";
import type { AiConfig } from "@/stores/use-config-store";
import type { ReferenceAudio } from "@/types/media";

export type AudioGenerationResult = { assetId: string };

export async function requestAudioGeneration(config: AiConfig, prompt: string, options?: GenerationOptions & { audios?: ReferenceAudio[] }): Promise<AudioGenerationResult> {
    const task = await waitForGeneration(await createGeneration(config, "audio", { prompt, audios: options?.audios }, options), options);
    if (!task.assetIds[0]) throw new Error(i18n.t("errors.audioNotSaved"));
    return { assetId: task.assetIds[0] };
}
