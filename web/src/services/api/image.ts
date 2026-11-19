import { createGeneration, waitForGeneration, type GenerationOptions } from "./tasks";
import { assetUrl } from "./assets";
import type { AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";

export type AiTextMessage = {
    role: "system" | "user" | "assistant";
    content: string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;
};

export async function requestGeneration(config: AiConfig, prompt: string, options?: GenerationOptions) {
    const task = await waitForGeneration(await createGeneration(config, "image", { prompt }, options), options);
    return task.assetIds.map((id) => ({ id, dataUrl: assetUrl(id), storageKey: `asset:${id}` }));
}

export async function requestEdit(config: AiConfig, prompt: string, references: ReferenceImage[], options?: GenerationOptions) {
    const task = await waitForGeneration(await createGeneration(config, "image", { prompt, references }, options), options);
    return task.assetIds.map((id) => ({ id, dataUrl: assetUrl(id), storageKey: `asset:${id}` }));
}

export async function requestImageQuestion(config: AiConfig, messages: AiTextMessage[], onDelta: (text: string) => void, options?: GenerationOptions & { videos?: ReferenceVideo[]; audios?: ReferenceAudio[] }) {
    const task = await waitForGeneration(await createGeneration(config, "text", { messages, videos: options?.videos, audios: options?.audios }, options), { ...options, onText: onDelta });
    return task.text;
}
