import { imageReferenceLabel } from "@/lib/image-reference-prompt";
import i18n from "@/i18n";
import { getNodeDefinition } from "@/lib/canvas/node-registry";
import { getDataUrlByteSize, readImageMeta } from "@/lib/image-utils";
import { imageToDataUrl } from "@/services/image-storage";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

export type CanvasResourceKind = "image" | "video" | "audio" | "text";

export type CanvasNodeReferenceEntry = { node: CanvasNodeData; sourceNodeId: string };

export type CanvasResourceReference = {
    id: string;
    nodeId: string;
    kind: CanvasResourceKind;
    label: string;
    title: string;
    previewUrl?: string;
    text?: string;
    active: boolean;
};

export function buildNodeMentionReferences(node: CanvasNodeData, nodes: CanvasNodeData[], connections: CanvasConnection[], includeSourceImage = false) {
    return labelResourceNodes(getMentionResourceNodes(node.id, nodes, connections, includeSourceImage), true);
}

export function buildCanvasResourceReferences(nodes: CanvasNodeData[]) {
    return labelResourceNodes(nodes, true);
}

export async function resolveCanvasReferenceImages(references: CanvasResourceReference[], nodes: CanvasNodeData[]) {
    const nodesById = new Map(nodes.map((node) => [node.id, node]));
    return Promise.all(references.filter((reference) => reference.kind === "image").map(async (reference) => {
        const node = nodesById.get(reference.nodeId);
        if (!node) throw new Error(i18n.t("agent.composer.mentions.resourceMissing", { title: reference.title }));
        const metadata = node.metadata;
        const dataUrl = await imageToDataUrl({ storageKey: metadata?.storageKey, url: reference.previewUrl });
        if (!dataUrl.startsWith("data:image/")) throw new Error(i18n.t("agent.composer.mentions.imageReadFailed", { title: reference.title }));
        const meta = metadata?.naturalWidth && metadata.naturalHeight
            ? { width: metadata.naturalWidth, height: metadata.naturalHeight, mimeType: metadata.mimeType || dataUrl.match(/^data:([^;]+)/)?.[1] || "image/png" }
            : await readImageMeta(dataUrl);
        return {
            id: `canvas:${node.id}`,
            name: reference.title,
            type: metadata?.mimeType || meta.mimeType,
            size: metadata?.bytes || getDataUrlByteSize(dataUrl),
            width: meta.width,
            height: meta.height,
            url: reference.previewUrl || dataUrl,
            dataUrl,
        };
    }));
}

export function getMentionResourceNodes(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[], includeSourceImage = false) {
    return getNodeReferenceEntries(nodeId, nodes, connections, includeSourceImage).map((entry) => entry.node);
}

export function getNodeReferenceEntries(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[], includeSourceImage = false): CanvasNodeReferenceEntry[] {
    const node = nodes.find((item) => item.id === nodeId);
    const inputs = getGenerationResourceNodes(nodeId, nodes, connections).flatMap((source) =>
        (source.type === CanvasNodeType.Group ? getGroupResourceNodes(source.id, nodes) : [source])
            .filter((resource) => resource.id !== nodeId && isResourceNode(resource))
            .map((resource) => ({ node: resource, sourceNodeId: source.id })),
    );
    if (includeSourceImage && node?.type === CanvasNodeType.Image && node.metadata?.content) inputs.unshift({ node, sourceNodeId: nodeId });
    const remaining = new Map(inputs.map((entry) => [entry.node.id, entry]));
    const ordered = (node?.metadata?.referenceOrder || []).flatMap((id) => {
        const entry = remaining.get(id);
        remaining.delete(id);
        return entry ? [entry] : [];
    });
    return [...ordered, ...remaining.values()];
}

export function reorderNodeReferences(node: CanvasNodeData, nodes: CanvasNodeData[], connections: CanvasConnection[], referenceIds: string[], prompt: string, includeSourceImage = false): CanvasNodeData {
    const previous = getNodeReferenceEntries(node.id, nodes, connections, includeSourceImage);
    const byId = new Map(previous.map((entry) => [entry.node.id, entry]));
    const requested = [...new Set(referenceIds)].filter((id) => byId.has(id));
    const selected = new Set(requested);
    let index = 0;
    const next = previous.map((entry) => selected.has(entry.node.id) ? byId.get(requested[index++])! : entry);
    if (next.every((entry, position) => entry.node.id === previous[position].node.id)) return node;
    const nextPrompt = renumberReferencePrompt(prompt, buildCanvasResourceReferences(previous.map((entry) => entry.node)), buildCanvasResourceReferences(next.map((entry) => entry.node)));
    const promptKey = node.type === CanvasNodeType.Config || node.type === CanvasNodeType.Text && Boolean(node.metadata?.content?.trim()) || node.type === CanvasNodeType.Image && Boolean(node.metadata?.content) ? "composerContent" : "prompt";
    return { ...node, metadata: { ...node.metadata, referenceOrder: next.map((entry) => entry.node.id), [promptKey]: nextPrompt } };
}

export function renumberReferencePrompt(prompt: string, previous: CanvasResourceReference[], next: CanvasResourceReference[]) {
    const labels = new Map(next.map((reference) => [reference.nodeId, reference.label]));
    const replacements = new Map(previous.map((reference) => [reference.label, labels.get(reference.nodeId) || reference.label]));
    if (!replacements.size) return prompt;
    const pattern = [...replacements.keys()].sort((left, right) => right.length - left.length).map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
    return prompt.replace(new RegExp(`(?:${pattern})(?!\\d)`, "g"), (label) => replacements.get(label)!);
}

export function getGenerationResourceNodes(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    return getContextInputNodes(getGenerationReferenceTarget(nodeId, nodes, connections), nodes, connections).filter((node) => node.id !== nodeId);
}

export function getGenerationReferenceTarget(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const connection = connections.find((connection) => connection.fromNodeId === nodeId && nodes.find((node) => node.id === connection.toNodeId)?.type === CanvasNodeType.Config);
    return connection && getContextInputNodes(connection.toNodeId, nodes, connections).some((node) => node.id !== nodeId) ? connection.toNodeId : nodeId;
}

function getContextInputNodes(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    return connections
        .filter((connection) => connection.toNodeId === nodeId)
        .map((connection) => nodes.find((node) => node.id === connection.fromNodeId))
        .filter((node): node is CanvasNodeData => Boolean(node && isCanvasReferenceNode(node, nodes)));
}

function hasGroupResources(node: CanvasNodeData, nodes: CanvasNodeData[]) {
    return node.type === CanvasNodeType.Group && getGroupResourceNodes(node.id, nodes).length > 0;
}

export function isCanvasReferenceNode(node: CanvasNodeData, nodes: CanvasNodeData[]) {
    return isResourceNode(node) || hasGroupResources(node, nodes);
}

export function getGroupResourceNodes(groupId: string, nodes: CanvasNodeData[]) {
    return nodes.filter((node) => node.metadata?.groupId === groupId && isResourceNode(node));
}

function labelResourceNodes(nodes: CanvasNodeData[], active: boolean) {
    const counts: Record<CanvasResourceKind, number> = { image: 0, video: 0, audio: 0, text: 0 };
    return nodes.flatMap((node): CanvasResourceReference[] => {
        const kind = resourceKind(node);
        if (!kind) return [];
        const resource = getNodeDefinition(node.type)?.resource?.(node);
        const index = counts[kind]++;
        const label = resourceReferenceLabel(kind, index);
        return [
            {
                id: node.id,
                nodeId: node.id,
                kind,
                label,
                title: node.title || label,
                previewUrl: node.metadata?.content || resource?.url,
                text: resourceText(node),
                active,
            },
        ];
    });
}

export function resourceReferenceLabel(kind: CanvasResourceKind, index: number) {
    if (kind === "image") return imageReferenceLabel(index);
    return i18n.t(`canvas.composer.resources.${kind}`, { index: index + 1 });
}

function isResourceNode(node: CanvasNodeData) {
    return Boolean(resourceKind(node));
}

function resourceText(node: CanvasNodeData): string | undefined {
    if (node.type === CanvasNodeType.Text) return node.metadata?.content || node.metadata?.prompt;
    const resource = getNodeDefinition(node.type)?.resource?.(node);
    return resource?.kind === "text" ? resource.text : undefined;
}

export function resourceKind(node: CanvasNodeData): CanvasResourceKind | null {
    if (node.type === CanvasNodeType.Image && node.metadata?.content) return "image";
    if (node.type === CanvasNodeType.Video && node.metadata?.content) return "video";
    if (node.type === CanvasNodeType.Audio && node.metadata?.content) return "audio";
    if (node.type === CanvasNodeType.Text && (node.metadata?.content || node.metadata?.prompt)) return "text";
    // Plugin nodes declare their input eligibility through definition.resource.
    return getNodeDefinition(node.type)?.resource?.(node)?.kind || null;
}
