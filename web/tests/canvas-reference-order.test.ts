import { expect, test, vi } from "vitest";
import type { CanvasConnection, CanvasNodeData, CanvasNodeMetadata } from "../src/types/canvas";

vi.mock("@/i18n", () => ({ default: { t: (key: string, values?: { index: number }) => {
    const labels: Record<string, string> = { "imageReferences.label": "图片", "canvas.composer.resources.video": "视频", "canvas.composer.resources.audio": "音频", "canvas.composer.resources.text": "文本" };
    return labels[key] ? `${labels[key]}${values?.index}` : key;
} } }));
vi.mock("@/services/image-storage", () => ({ imageToDataUrl: vi.fn() }));
vi.mock("@/services/api/client", () => ({ captureSession: () => () => {}, apiRequest: vi.fn(), jsonRequest: vi.fn() }));
vi.mock("@/lib/canvas/canvas-generation-helpers", () => ({ generationMaterialControls: () => [] }));

const { buildCanvasResourceReferences, buildNodeMentionReferences, getNodeReferenceEntries, renumberReferencePrompt, reorderNodeReferences } = await import("../src/lib/canvas/canvas-resource-references");
const { buildNodeGenerationContext } = await import("../src/components/canvas/canvas-node-generation");
const { CanvasNodeType } = await import("../src/types/canvas");

const node = (id: string, type = CanvasNodeType.Image, metadata: CanvasNodeMetadata = {}): CanvasNodeData => ({ id, type, title: id, width: 320, height: 240, position: { x: 0, y: 0 }, metadata });
const image = (id: string, metadata: CanvasNodeMetadata = {}) => node(id, CanvasNodeType.Image, { content: `/api/assets/${id}/file`, storageKey: `asset:${id}`, ...metadata });
const connect = (fromNodeId: string, toNodeId = "target"): CanvasConnection => ({ id: `${fromNodeId}-${toNodeId}`, fromNodeId, toNodeId });

test("dragging mixed references renumbers mentions and submits the same per-kind order", () => {
    const target = node("target", CanvasNodeType.Text, { prompt: "图片1到图片2，视频1与文本1" });
    const nodes = [target, image("first"), node("video", CanvasNodeType.Video, { content: "/video.mp4" }), image("second"), node("text", CanvasNodeType.Text, { content: "reference text" })];
    const connections = ["first", "video", "second", "text"].map((id) => connect(id));
    const next = reorderNodeReferences(target, nodes, connections, ["text", "second", "video", "first"], target.metadata!.prompt!);
    const reordered = nodes.map((item) => item.id === target.id ? next : item);
    expect(next.metadata?.referenceOrder).toEqual(["text", "second", "video", "first"]);
    expect(next.metadata?.prompt).toBe("图片2到图片1，视频1与文本1");
    expect(buildNodeMentionReferences(next, reordered, connections).map(({ nodeId, label }) => [nodeId, label])).toEqual([["text", "文本1"], ["second", "图片1"], ["video", "视频1"], ["first", "图片2"]]);
    const context = buildNodeGenerationContext(next.id, reordered, connections, next.metadata!.prompt!);
    expect(context.referenceImages.map((reference) => reference.id)).toEqual(["second", "first"]);
    expect(context.referenceVideos.map((reference) => reference.id)).toEqual(["video"]);
    expect(context.prompt).toBe("图片2到图片1，视频1与文本1\n\n【文本1】\nreference text");
});

test("group children can be reordered with external references without duplicate inputs or changing connections", () => {
    const target = node("target", CanvasNodeType.Video);
    const nodes = [target, node("group", CanvasNodeType.Group), image("first", { groupId: "group" }), image("second", { groupId: "group" }), image("external")];
    const connections = [connect("group"), connect("external"), connect("second")];
    const next = reorderNodeReferences(target, nodes, connections, ["external", "second", "first"], "图片1与图片3");
    const reordered = nodes.map((item) => item.id === target.id ? next : item);
    expect(getNodeReferenceEntries(next.id, reordered, connections).map(({ node: resource }) => resource.id)).toEqual(["external", "second", "first"]);
    expect(getNodeReferenceEntries(next.id, reordered, connections).find(({ node: resource }) => resource.id === "first")?.sourceNodeId).toBe("group");
    expect(buildNodeGenerationContext(next.id, reordered, connections, "").referenceImages.map((reference) => reference.id)).toEqual(["external", "second", "first"]);
    expect(connections).toEqual([connect("group"), connect("external"), connect("second")]);
    expect(target.metadata?.referenceOrder).toBeUndefined();
});

test("label swaps are simultaneous and do not corrupt multi-digit labels", () => {
    const images = Array.from({ length: 12 }, (_, index) => image(`image-${index + 1}`));
    const next = [...images];
    [next[0], next[9]] = [next[9], next[0]];
    expect(renumberReferencePrompt("图片1 / 图片10 / 图片11 / 图片100 / 图片1", buildCanvasResourceReferences(images), buildCanvasResourceReferences(next))).toBe("图片10 / 图片1 / 图片11 / 图片100 / 图片10");
});

test("filtered reordering retains hidden references and concurrent additions without reviving missing nodes", () => {
    const target = node("target", CanvasNodeType.Video, { referenceOrder: ["missing", "first", "audio", "second"] });
    const nodes = [target, image("first"), node("audio", CanvasNodeType.Audio, { content: "/audio.mp3" }), image("second"), image("new")];
    const connections = ["first", "audio", "second", "new"].map((id) => connect(id));
    const next = reorderNodeReferences(target, nodes, connections, ["second", "missing", "first", "second"], "图片1");
    expect(next.metadata?.referenceOrder).toEqual(["second", "audio", "first", "new"]);
    expect(next.metadata?.prompt).toBe("图片2");
    expect(buildNodeGenerationContext(next.id, [next, ...nodes.slice(1)], connections, "").referenceAudios[0].id).toBe("audio");
});

test("editing an existing image includes its source card in the displayed and submitted order", () => {
    const target = image("target", { composerContent: "图片1到图片2", modelParameters: { model: { first_frame: "asset:reference" } } });
    const nodes = [target, image("reference")];
    const connections = [connect("reference")];
    const next = reorderNodeReferences(target, nodes, connections, ["reference", "target"], target.metadata!.composerContent!, true);
    const reordered = [next, nodes[1]];
    expect(next.metadata?.composerContent).toBe("图片2到图片1");
    expect(next.metadata?.content).toBe(target.metadata?.content);
    expect(next.metadata?.modelParameters).toBe(target.metadata?.modelParameters);
    expect(buildNodeMentionReferences(next, reordered, connections, true).map((reference) => reference.nodeId)).toEqual(["reference", "target"]);
    expect(buildNodeGenerationContext(next.id, reordered, connections, "", true).referenceImages.map((reference) => reference.id)).toEqual(["reference", "target"]);
    expect(buildNodeGenerationContext(next.id, reordered, connections, "").referenceImages.map((reference) => reference.id)).toEqual(["reference"]);
});

test("connected config nodes share inputs while preserving each editor's reference order", () => {
    const target = node("target", CanvasNodeType.Text);
    const config = node("config", CanvasNodeType.Config);
    const nodes = [target, config, image("first"), image("second")];
    const connections = [connect("target", "config"), connect("first", "config"), connect("second", "config")];
    const next = reorderNodeReferences(target, nodes, connections, ["second", "first"], "图片1");
    const reordered = [next, ...nodes.slice(1)];
    expect(buildNodeGenerationContext(next.id, reordered, connections, next.metadata!.prompt!).referenceImages.map((reference) => reference.id)).toEqual(["second", "first"]);
    expect(config.metadata?.referenceOrder).toBeUndefined();
    expect(nodes[0].metadata?.referenceOrder).toBeUndefined();
});

test("an unchanged drop does not create a new project edit", () => {
    const target = node("target", CanvasNodeType.Text);
    const nodes = [target, image("first"), image("second")];
    expect(reorderNodeReferences(target, nodes, [connect("first"), connect("second")], ["first", "second"], "")).toBe(target);
});
