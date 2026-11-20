import { expect, test } from "vitest";
import { mediaResultKind, nodePrimaryResultId, nodeResults, selectNodePrimaryResult } from "../src/lib/canvas/canvas-node-results";
import { CanvasNodeType, type CanvasNodeData, type CanvasNodeImage } from "../src/types/canvas";

const result = (id: string, patch: Partial<CanvasNodeImage> = {}): CanvasNodeImage => ({ id, status: "success", content: `/api/assets/${id}/file`, storageKey: `asset:${id}`, naturalWidth: 1920, naturalHeight: 1080, bytes: 1024, mimeType: "video/mp4", durationMs: 3000, ...patch });
const node = (patch: Partial<CanvasNodeData> = {}): CanvasNodeData => ({ id: "node", type: CanvasNodeType.Video, title: "Video", position: { x: 20, y: 40 }, width: 320, height: 180, metadata: { content: "/api/assets/one/file", storageKey: "asset:one", status: "success", primaryMediaId: "one", mediaResults: [result("one"), result("two", { naturalWidth: 1080, naturalHeight: 1920, durationMs: 65000, bytes: 2048 })], prompt: "Keep this prompt" }, ...patch });

test("selecting a video result updates the whole primary asset while keeping the node center", () => {
    const original = node();
    const selected = selectNodePrimaryResult(original, "two");
    expect(nodePrimaryResultId(selected)).toBe("two");
    expect(selected.metadata).toMatchObject({ content: "/api/assets/two/file", storageKey: "asset:two", naturalWidth: 1080, naturalHeight: 1920, durationMs: 65000, bytes: 2048, mimeType: "video/mp4", prompt: "Keep this prompt" });
    expect(selected.position.x + selected.width / 2).toBe(original.position.x + original.width / 2);
    expect(selected.position.y + selected.height / 2).toBe(original.position.y + original.height / 2);
    expect(selected.width / selected.height).toBeCloseTo(1080 / 1920);
    expect(original.metadata?.primaryMediaId).toBe("one");
    expect(selectNodePrimaryResult(selected, "two")).toBe(selected);
});

test("loading, failed, empty and missing results cannot be made primary", () => {
    const original = node();
    original.metadata!.mediaResults = [result("loading", { status: "loading" }), result("failed", { status: "error" }), result("empty", { content: "" })];
    for (const id of ["loading", "failed", "empty", "missing"]) expect(selectNodePrimaryResult(original, id)).toBe(original);
});

test("image results keep free sizing and use the existing primary image field", () => {
    const original = node({ type: CanvasNodeType.Image, metadata: { freeResize: true, images: [result("one", { mimeType: "image/png" }), result("two", { mimeType: "image/png", durationMs: undefined })], primaryImageId: "one" } });
    const selected = selectNodePrimaryResult(original, "two");
    expect(selected.metadata?.primaryImageId).toBe("two");
    expect(selected.metadata?.primaryMediaId).toBeUndefined();
    expect(selected.metadata?.durationMs).toBeUndefined();
    expect(selected.position).toEqual(original.position);
    expect([selected.width, selected.height]).toEqual([original.width, original.height]);
});

test("text alternatives remain live and keep a sibling's loading state", () => {
    const original = node({ type: CanvasNodeType.Text, metadata: { texts: [{ id: "one", content: "First", status: "success" }, { id: "two", content: "Second", status: "success" }, { id: "three", content: "", status: "loading" }], primaryTextId: "one" } });
    const selected = selectNodePrimaryResult(original, "two");
    expect(nodeResults(selected)).toHaveLength(3);
    expect(selected.metadata).toMatchObject({ content: "Second", primaryTextId: "two", status: "loading" });
    expect(selected.position).toEqual(original.position);
});

test("upscale and audio results use their actual media type and retain dimensions when unknown", () => {
    const original = node({ type: "upscale:media" });
    expect(mediaResultKind(original, result("video"))).toBe("video");
    expect(mediaResultKind(original, result("image", { mimeType: "image/webp" }))).toBe("image");
    original.type = CanvasNodeType.Audio;
    original.metadata!.mediaResults = [result("one"), result("two", { mimeType: "audio/mpeg", naturalWidth: 0, naturalHeight: 0 })];
    const selected = selectNodePrimaryResult(original, "two");
    expect(mediaResultKind(selected, selected.metadata!.mediaResults![1])).toBe("audio");
    expect([selected.width, selected.height]).toEqual([original.width, original.height]);
});

test("changing a primary result does not dismiss an active node task", () => {
    const original = node();
    original.metadata!.status = "loading";
    expect(selectNodePrimaryResult(original, "two").metadata).toMatchObject({ primaryMediaId: "two", status: "loading" });
});
