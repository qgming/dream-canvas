import { getNodeSpec } from "@/constant/canvas";
import i18n from "@/i18n";
import { isNodeTypeEnabled } from "@/lib/canvas/node-registry";
import { resolveModelParameters, useConfigStore, type AiConfig } from "@/stores/use-config-store";
import type { UploadedImage } from "@/services/image-storage";
import type { UploadedFile } from "@/services/file-storage";
import type { ReferenceImage } from "@/types/image";
import { CanvasNodeType, type CanvasImageGenerationType, type CanvasNodeData, type CanvasNodeMetadata, type CanvasNodeTypeId, type Position } from "@/types/canvas";

export function createCanvasNode(type: CanvasNodeTypeId, position: Position, metadata?: CanvasNodeMetadata): CanvasNodeData {
    if (!isNodeTypeEnabled(type)) throw new Error(i18n.t("nodePlugins.unavailable"));
    const spec = getNodeSpec(type);
    const id = `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const config = useConfigStore.getState().config;
    const initialModel = type === CanvasNodeType.Image || type === CanvasNodeType.Config ? config.imageModel : type === CanvasNodeType.Video ? config.videoModel : type === CanvasNodeType.Audio ? config.audioModel : type === CanvasNodeType.Text ? config.textModel : "";

    return {
        id,
        type,
        title: spec.title,
        position: {
            x: position.x - spec.width / 2,
            y: position.y - spec.height / 2,
        },
        width: spec.width,
        height: spec.height,
        metadata: { ...spec.metadata, ...(initialModel ? { model: initialModel } : {}), ...metadata },
    };
}

export function imageMetadata(image: UploadedImage): CanvasNodeMetadata {
    return { content: image.url, storageKey: image.storageKey, status: "success", naturalWidth: image.width, naturalHeight: image.height, bytes: image.bytes, mimeType: image.mimeType };
}

export function videoMetadata(video: UploadedFile): CanvasNodeMetadata {
    return { content: video.url, storageKey: video.storageKey, status: "success", naturalWidth: video.width, naturalHeight: video.height, bytes: video.bytes, mimeType: video.mimeType || "video/mp4", durationMs: video.durationMs };
}

export function audioMetadata(audio: UploadedFile): CanvasNodeMetadata {
    return { content: audio.url, storageKey: audio.storageKey, status: "success", bytes: audio.bytes, mimeType: audio.mimeType || "audio/mpeg", durationMs: audio.durationMs };
}

export function referenceUrl(image: ReferenceImage) {
    return image.storageKey || image.url || (!image.dataUrl.startsWith("data:") ? image.dataUrl : undefined);
}

export function buildImageGenerationMetadata(type: CanvasImageGenerationType, config: AiConfig, references: ReferenceImage[]): CanvasNodeMetadata {
    return {
        generationType: type,
        model: config.model,
        modelParameters: { [config.model]: resolveModelParameters(config, config.model, config.modelParameters) },
        references: references.map(referenceUrl).filter((url): url is string => Boolean(url)),
    };
}

export function buildAudioGenerationMetadata(config: AiConfig): CanvasNodeMetadata {
    return {
        model: config.model,
        modelParameters: { [config.model]: resolveModelParameters(config, config.model, config.modelParameters) },
    };
}

export function applyNodeConfigPatch(node: CanvasNodeData, patch: Partial<CanvasNodeData["metadata"]>) {
    return { ...node, metadata: { ...node.metadata, ...patch } };
}
