import { CanvasNodeType, type CanvasNodeData, type CanvasNodeImage, type CanvasNodeText } from "@/types/canvas";
import { fitNodeSize } from "./canvas-node-size";

export function nodeMediaResults(node: CanvasNodeData): CanvasNodeImage[] {
    return node.metadata?.mediaResults || node.metadata?.images || [];
}

export function nodeResults(node: CanvasNodeData): (CanvasNodeImage | CanvasNodeText)[] {
    return node.type === CanvasNodeType.Text ? node.metadata?.texts || [] : nodeMediaResults(node);
}

export function nodePrimaryResultId(node: CanvasNodeData) {
    return (node.type === CanvasNodeType.Text ? node.metadata?.primaryTextId : node.metadata?.mediaResults ? node.metadata.primaryMediaId : node.metadata?.primaryImageId) || nodeResults(node)[0]?.id;
}

export function mediaResultKind(node: CanvasNodeData, result: CanvasNodeImage): "image" | "video" | "audio" {
    if (result.mimeType.startsWith("video/")) return CanvasNodeType.Video;
    if (result.mimeType.startsWith("audio/")) return CanvasNodeType.Audio;
    if (result.mimeType.startsWith("image/")) return CanvasNodeType.Image;
    if (node.type === CanvasNodeType.Audio) return CanvasNodeType.Audio;
    return node.type === CanvasNodeType.Video || node.metadata?.generationMode === "video" ? CanvasNodeType.Video : CanvasNodeType.Image;
}

export function selectNodePrimaryResult(node: CanvasNodeData, resultId: string): CanvasNodeData {
    const results = nodeResults(node);
    const selected = results.find((result) => result.id === resultId);
    if (!selected?.content || selected.status !== "success") return node;
    if (nodePrimaryResultId(node) === resultId && node.metadata?.content === selected.content) return node;
    const metadata = { ...node.metadata, content: selected.content, status: node.metadata?.status === "loading" || results.some((result) => result.status === "loading") ? "loading" as const : selected.status, errorDetails: undefined };
    if (node.type === CanvasNodeType.Text) return { ...node, metadata: { ...metadata, primaryTextId: selected.id } };
    const media = selected as CanvasNodeImage;
    const size = !metadata.freeResize && media.naturalWidth > 0 && media.naturalHeight > 0
        ? fitNodeSize(media.naturalWidth, media.naturalHeight, Math.max(node.width, node.height), Math.max(node.width, node.height))
        : { width: node.width, height: node.height };
    return {
        ...node,
        ...size,
        position: { x: node.position.x + (node.width - size.width) / 2, y: node.position.y + (node.height - size.height) / 2 },
        metadata: { ...metadata, storageKey: media.storageKey, naturalWidth: media.naturalWidth, naturalHeight: media.naturalHeight, bytes: media.bytes, mimeType: media.mimeType, durationMs: media.durationMs, ...(metadata.mediaResults ? { primaryMediaId: media.id } : { primaryImageId: media.id }) },
    };
}
