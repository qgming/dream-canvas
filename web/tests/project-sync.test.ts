import { expect, test } from "vitest";
import { applyProjectChanges, projectChanges, rebaseProject } from "../src/lib/canvas/project-sync";
import type { CanvasProject } from "../src/stores/canvas/use-canvas-store";

const project = (): CanvasProject => ({ id: "p", title: "Canvas", version: 1, createdAt: "", updatedAt: "", nodes: [{ id: "a", type: "text", title: "A", position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { content: "base", status: "success" } }], connections: [], chatSessions: [], activeChatId: null, backgroundMode: "lines", showImageInfo: false, viewport: { x: 0, y: 0, k: 1 } });

test("concurrent move and assistant content edit both survive", () => {
    const base = project(), local = structuredClone(base), remote = structuredClone(base);
    local.nodes[0].position.x = 80;
    remote.nodes[0].metadata!.content = "assistant";
    const result = rebaseProject(base, local, remote);
    expect(result.nodes[0].position.x).toBe(80);
    expect(result.nodes[0].metadata!.content).toBe("assistant");
});

test("concurrent node additions survive without positional array patches", () => {
    const base = project(), local = structuredClone(base), remote = structuredClone(base);
    local.nodes.push({ ...base.nodes[0], id: "b" });
    remote.nodes.push({ ...base.nodes[0], id: "c" });
    const result = rebaseProject(base, local, remote);
    expect(new Set(result.nodes.map((node) => node.id))).toEqual(new Set(["a", "b", "c"]));
    expect(base.nodes).toHaveLength(1);
});

test("a deleted target cannot be silently resurrected by a stale edit", () => {
    const base = project(), local = structuredClone(base), remote = structuredClone(base);
    local.nodes[0].metadata!.content = "unsaved";
    remote.nodes = [];
    expect(() => rebaseProject(base, local, remote)).toThrow();
    expect(local.nodes[0].metadata!.content).toBe("unsaved");
});

test("final task content replaces stale streaming text while preserving a move", () => {
    const base = project(), local = structuredClone(base), remote = structuredClone(base);
    base.nodes[0].metadata = { content: "", status: "loading" };
    local.nodes[0].metadata = { content: "partial", status: "loading" };
    local.nodes[0].position.y = 25;
    remote.nodes[0].metadata = { content: "complete", status: "success" };
    const result = rebaseProject(base, local, remote);
    expect(result.nodes[0].metadata).toEqual(remote.nodes[0].metadata);
    expect(result.nodes[0].position.y).toBe(25);
});

test("null-valued model parameters are retained and removed fields remain removed", () => {
    const base = project(), next = structuredClone(base);
    next.nodes[0].metadata = { modelParameters: { model: { seed: null } }, status: "success" };
    expect(applyProjectChanges(base, projectChanges(base, next))).toEqual(next);
});

test("removing a node clears connections but keeps unrelated additions", () => {
    const base = project();
    base.nodes.push({ ...base.nodes[0], id: "b" });
    base.connections = [{ id: "ab", fromNodeId: "a", toNodeId: "b" }];
    const local = structuredClone(base), remote = structuredClone(base);
    local.nodes = [local.nodes[0]]; local.connections = [];
    remote.nodes.push({ ...base.nodes[0], id: "c" });
    const result = rebaseProject(base, local, remote);
    expect(result.connections).toEqual([]);
    expect(result.nodes.map((node) => node.id)).toContain("c");
});

test("video results arrive with a completed task without losing a concurrent move", () => {
    const base = project();
    base.nodes[0] = { ...base.nodes[0], type: "video", metadata: { status: "loading" } };
    const local = structuredClone(base), remote = structuredClone(base);
    local.nodes[0].position.x = 70;
    remote.nodes[0].metadata = { status: "success", content: "/api/assets/one/file", storageKey: "asset:one", primaryMediaId: "one", mediaResults: ["one", "two"].map((id) => ({ id, status: "success", content: `/api/assets/${id}/file`, storageKey: `asset:${id}`, naturalWidth: 1920, naturalHeight: 1080, bytes: 1024, mimeType: "video/mp4", durationMs: 5000 })) };
    const saved = rebaseProject(base, local, remote);
    expect(saved.nodes[0].metadata).toEqual(remote.nodes[0].metadata);
    expect(saved.nodes[0].position.x).toBe(70);
});

test("finishing a sibling result does not overwrite an explicitly selected primary", () => {
    const base = project();
    base.nodes[0].metadata = { status: "loading", content: "First", primaryTextId: "one", texts: [{ id: "one", content: "First", status: "success" }, { id: "two", content: "Second", status: "success" }, { id: "three", content: "", status: "loading" }] };
    const local = structuredClone(base), remote = structuredClone(base);
    local.nodes[0].metadata!.content = "Second";
    local.nodes[0].metadata!.primaryTextId = "two";
    remote.nodes[0].metadata!.status = "success";
    remote.nodes[0].metadata!.texts![2] = { id: "three", content: "Third", status: "success" };
    const saved = rebaseProject(base, local, remote);
    expect(saved.nodes[0].metadata).toMatchObject({ content: "Second", primaryTextId: "two", status: "success" });
    expect(saved.nodes[0].metadata!.texts![2].content).toBe("Third");
});
