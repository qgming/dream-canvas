import i18n from "@/i18n";
import { getGroupResourceNodes, resourceKind, type CanvasNodeReferenceEntry } from "./canvas-resource-references";
import { getNodeDefinition } from "./node-registry";
import { inputVisible } from "@/lib/model-inputs";
import { assetId, assetUrl } from "@/services/api/assets";
import { findChannelModel, resolveModelParameters, type AiConfig, type ChannelModel } from "@/stores/use-config-store";
import type { CanvasConnection, CanvasNodeData } from "@/types/canvas";

export type UpscaleKind = "image" | "video";
export const UPSCALE_NODE_TYPE = "upscale:media";
export const UPSCALE_ADD_REFERENCE_EVENT = "canvas:upscale:add-reference";

export function upscaleResource(node: CanvasNodeData) {
    const metadata = node.metadata;
    if (!metadata?.content) return null;
    const kind: UpscaleKind = metadata.mimeType?.startsWith("video/") ? "video" : metadata.mimeType?.startsWith("image/") ? "image" : metadata.generationMode === "video" ? "video" : "image";
    return { kind, url: metadata.content };
}

export function upscaleModelProfile(model: ChannelModel, parameters: Record<string, unknown> = {}) {
    if (model.capability !== "image" && model.capability !== "video") return null;
    const mode = model.parameters.find((control) => control.key === "mode" && control.type === "select");
    if (mode && !mode.options?.some((option) => option.value === "upscale")) return null;
    const values = { ...Object.fromEntries(model.parameters.filter((control) => control.type !== "reference" && control.default !== undefined).map((control) => [control.key, control.default])), ...parameters, ...(mode ? { [mode.key]: "upscale" } : {}) };
    if (model.capability === "image") {
        for (const control of model.parameters) if (["size", "ratio"].includes(control.key) && control.default !== undefined) values[control.key] = control.default;
    }
    const materials = model.parameters.filter((control) => (control.type === "asset" || control.type === "reference") && inputVisible(control, values));
    const sources = materials.filter((control) => control.role === model.capability);
    if (sources.length !== 1 || materials.some((control) => control.role !== model.capability && (control.required || (control.minCount || 0) > 0))) return null;
    const source = sources[0];
    if ((source.minCount || 0) > 1 || source.maxCount === 0) return null;
    const targetKeys = model.capability === "image" ? ["resolution", "quality"] : ["resolution", "scale", "size", "width", "height"];
    const targets = model.parameters.filter((control) => targetKeys.includes(control.key) && !control.hidden && inputVisible(control, values));
    return { kind: model.capability as UpscaleKind, source, targets, values };
}

export function upscaleSourceEntries(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]): CanvasNodeReferenceEntry[] {
    const entries = connections.filter((connection) => connection.toNodeId === nodeId).flatMap((connection) => {
        const source = nodes.find((node) => node.id === connection.fromNodeId);
        return source ? (source.type === "group" ? getGroupResourceNodes(source.id, nodes) : [source]).filter((node) => node.id !== nodeId && ["image", "video"].includes(resourceKind(node) || "")).map((node) => ({ node, sourceNodeId: source.id })) : [];
    });
    return [...new Map(entries.map((entry) => [entry.node.id, entry])).values()];
}

export function upscaleGenerationInput(config: AiConfig, model: string, source: CanvasNodeData, parameters: Record<string, unknown> = {}) {
    const selected = findChannelModel(config, model)?.model;
    const profile = selected && upscaleModelProfile(selected, parameters);
    if (!profile || resourceKind(source) !== profile.kind) throw new Error(i18n.t("canvas.upscale.modelMismatch"));
    const id = assetId(source.metadata?.storageKey) || assetId(source.metadata?.content) || assetId(getNodeDefinition(source.type)?.resource?.(source)?.url);
    if (!id) throw new Error(i18n.t("errors.uploadReferences"));
    const values = { ...profile.values, ...(profile.source.type === "asset" ? { [profile.source.key]: `asset:${id}` } : {}) };
    return { kind: profile.kind, url: assetUrl(id), parameters: resolveModelParameters(config, model, values) };
}
