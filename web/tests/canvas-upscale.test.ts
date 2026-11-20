import { expect, test, vi } from "vitest";
import type { CanvasConnection, CanvasNodeData } from "../src/types/canvas";
import type { ParameterControl } from "../src/services/api/channels";
import type { ChannelModel } from "../src/stores/use-config-store";

vi.mock("@/i18n", () => ({ default: { t: (key: string) => key } }));
vi.mock("@/services/image-storage", () => ({ imageToDataUrl: vi.fn() }));
vi.mock("@/services/api/client", () => ({ ApiError: class extends Error {}, setCsrfToken: vi.fn(), captureSession: () => () => {}, apiRequest: vi.fn(), jsonRequest: vi.fn() }));

const { defaultConfig, encodeChannelModel, resolveModelParameters } = await import("../src/stores/use-config-store");
const { registerNodeDefinitions, unregisterPluginNodes } = await import("../src/lib/canvas/node-registry");
const { upscaleGenerationInput, upscaleModelProfile, upscaleResource, upscaleSourceEntries } = await import("../src/lib/canvas/canvas-upscale");

const node = (id: string, type = "video", metadata: CanvasNodeData["metadata"] = { content: `/api/assets/${id}/file`, storageKey: `asset:${id}` }): CanvasNodeData => ({ id, type, title: id, position: { x: 0, y: 0 }, width: 420, height: 280, metadata });
const connect = (fromNodeId: string, toNodeId = "target"): CanvasConnection => ({ id: `${fromNodeId}-${toNodeId}`, fromNodeId, toNodeId });
const model = (capability: "image" | "video", parameters: ParameterControl[]): ChannelModel => ({ id: "model", name: "upscaler", label: "Upscaler", version: 1, features: {}, capability, parameters });
const resolution: ParameterControl = { key: "resolution", label: "Resolution", type: "select", default: "1080p", options: [{ label: "1080p", value: "1080p" }, { label: "4K", value: "4k" }] };

test("the dedicated node binds its connected video to the declared named source only", () => {
    const selected = model("video", [{ key: "mode", label: "Mode", type: "select", default: "upscale", options: [{ label: "Upscale", value: "upscale" }] }, { key: "source_video", label: "Source", type: "asset", role: "video", transport: "https" }, resolution, { key: "duration", label: "Duration", type: "number", advanced: true }]);
    const config = { ...defaultConfig, channels: [{ id: "channel", name: "Channel", models: [selected] }] };
    const parameters = { resolution: "4k", duration: 7, source_video: "asset:old" };
    const input = upscaleGenerationInput(config, encodeChannelModel("channel", "upscaler"), node("source"), parameters);
    expect(input).toEqual({ kind: "video", url: "/api/assets/source/file", parameters: { mode: "upscale", source_video: "asset:source", resolution: "4k", duration: 7 } });
    expect(parameters.source_video).toBe("asset:old");
    expect(resolveModelParameters(config, encodeChannelModel("channel", "upscaler"), parameters).source_video).toBe("asset:old");
    expect(upscaleModelProfile(selected)?.targets.map((control) => control.key)).toEqual(["resolution"]);
});

test("image-editing models accept one source without inventing a named parameter or prompt", () => {
    const selected = model("image", [{ key: "reference_images", label: "Images", type: "reference", role: "image" }, { key: "size", label: "Size", type: "text", default: "1:1", suggestions: [{ label: "1:1", value: "1:1" }, { label: "16:9", value: "16:9" }] }, resolution, { key: "quality", label: "Quality", type: "select", default: "auto", options: [{ label: "Auto", value: "auto" }, { label: "High", value: "high" }] }]);
    const config = { ...defaultConfig, channels: [{ id: "channel", name: "Channel", models: [selected] }] };
    const input = upscaleGenerationInput(config, "channel::upscaler", node("image", "image"), { size: "16:9", resolution: "4k", quality: "high" });
    expect(input).toEqual({ kind: "image", url: "/api/assets/image/file", parameters: { resolution: "4k", quality: "high", size: "1:1" } });
    expect(input).not.toHaveProperty("prompt");
    expect(upscaleModelProfile(selected)?.targets.map((control) => control.key)).toEqual(["resolution", "quality"]);
    const edited = { size: "auto", resolution: "4k", quality: "high" };
    expect(upscaleGenerationInput(config, "channel::upscaler", node("image", "image"), edited).parameters).toEqual(input.parameters);
    expect(edited.size).toBe("auto");
});

test("generation-only, frame and ambiguous source models are not offered for upscaling", () => {
    expect(upscaleModelProfile(model("image", [resolution]))).toBeNull();
    expect(upscaleModelProfile(model("video", [{ key: "mode", label: "Mode", type: "select", options: [{ label: "Frames", value: "frames" }] }, { key: "videos", label: "Videos", type: "reference", role: "video" }]))).toBeNull();
    expect(upscaleModelProfile(model("video", [{ key: "first", label: "First", type: "asset", role: "video" }, { key: "last", label: "Last", type: "asset", role: "video" }]))).toBeNull();
    expect(upscaleModelProfile(model("video", [{ key: "videos", label: "Videos", type: "reference", role: "video", minCount: 2 }]))).toBeNull();
    expect(upscaleModelProfile(model("video", [{ key: "videos", label: "Videos", type: "reference", role: "video" }, { key: "image", label: "Image", type: "asset", role: "image", required: true }]))).toBeNull();
});

test("upscale mode comes only from actual options and target suggestions remain editable", () => {
    const selected = model("video", [{ key: "mode", label: "Mode", type: "select", default: "generate", options: [{ label: "Generate", value: "generate" }, { label: "Upscale", value: "upscale" }] }, { key: "source", label: "Source", type: "reference", role: "video", when: { key: "mode", values: ["upscale"] } }, { ...resolution, type: "text", options: undefined, suggestions: [{ label: "2K", value: "2k" }] }]);
    expect(upscaleModelProfile(selected)?.values.mode).toBe("upscale");
    expect(upscaleModelProfile(selected)?.targets[0].suggestions).toEqual([{ label: "2K", value: "2k" }]);
    expect(upscaleModelProfile(selected)?.targets[0].options).toBeUndefined();
});

test("source references use direct inputs, expand groups, and never reuse this node's output", () => {
    const nodes = [node("target", "upscale:media"), node("first"), node("group", "group", {}), node("second", "image", { content: "/api/assets/second/file", groupId: "group" }), node("text", "text", { content: "not an input" }), node("config", "config", {})];
    const connections = [connect("first"), connect("group"), connect("second"), connect("text"), connect("target"), connect("target", "config"), connect("text", "config")];
    expect(upscaleSourceEntries("target", nodes, connections).map((entry) => entry.node.id)).toEqual(["first", "second"]);
    expect(upscaleSourceEntries("target", nodes, connections).find((entry) => entry.node.id === "second")?.sourceNodeId).toBe("second");
    expect(upscaleSourceEntries("target", [nodes[0], node("first", "video", {})], [connect("first")])).toEqual([]);
});

test("an explicit image or video source must match the selected model and be a saved asset", () => {
    const selected = model("video", [{ key: "source_video", label: "Source", type: "asset", role: "video" }]);
    const config = { ...defaultConfig, channels: [{ id: "channel", name: "Channel", models: [selected] }] };
    expect(() => upscaleGenerationInput(config, "channel::upscaler", node("image", "image"))).toThrow("canvas.upscale.modelMismatch");
    expect(() => upscaleGenerationInput(config, "channel::removed", node("source"))).toThrow("canvas.upscale.modelMismatch");
    expect(() => upscaleGenerationInput(config, "channel::upscaler", node("source", "video", { content: "blob:temporary" }))).toThrow("errors.uploadReferences");
});

test("plugin outputs remain usable as stable inputs and their real MIME takes precedence over failed attempts", () => {
    registerNodeDefinitions([{ type: "source:media", title: "Source", icon: null, defaultSize: { width: 320, height: 240 }, resource: () => ({ kind: "video", url: "/api/assets/plugin-output/file" }) }], "upscale-test");
    try {
        const selected = model("video", [{ key: "videos", label: "Videos", type: "reference", role: "video" }]);
        const config = { ...defaultConfig, channels: [{ id: "channel", name: "Channel", models: [selected] }] };
        expect(upscaleGenerationInput(config, "channel::upscaler", node("plugin", "source:media", {})).url).toBe("/api/assets/plugin-output/file");
        expect(upscaleResource(node("image", "upscale:media", { content: "/api/assets/image/file", mimeType: "image/png", generationMode: "video" }))?.kind).toBe("image");
        expect(upscaleResource(node("video", "upscale:media", { content: "/api/assets/video/file", mimeType: "video/mp4", generationMode: "image" }))?.kind).toBe("video");
    } finally { unregisterPluginNodes("upscale-test"); }
});
