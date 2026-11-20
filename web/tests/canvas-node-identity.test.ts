import { expect, test } from "vitest";
import { assignCanvasNodeIdentities, canvasNodeDisplayName, canvasNodeIdentities, copiedCanvasNodeIdentity, copiedCanvasNodeName, formatCanvasNodeName } from "../src/lib/canvas/canvas-node-identity";
import type { CanvasNodeData, CanvasNodeIdentity } from "../src/types/canvas";

const node = (id: string, type = "image", identity?: CanvasNodeIdentity): CanvasNodeData => ({ id, type, identity, title: "Prompt or filename", position: { x: 0, y: 0 }, width: 320, height: 240, metadata: { prompt: "Keep the real prompt", content: "Keep the content" } });
const names = (nodes: CanvasNodeData[]) => {
    const identities = canvasNodeIdentities(nodes);
    return nodes.map((item) => formatCanvasNodeName(item.type, identities.get(item.id)!));
};

test("each node type numbers every node in the whole canvas independently", () => {
    const nodes = [node("image-a"), node("video-a", "video"), node("image-b"), node("text-a", "text"), node("audio-a", "audio"), node("video-b", "video"), node("upscale-a", "upscale:media"), node("note-a", "sticky-note:note")];
    expect(names(nodes)).toEqual(["image1", "video1", "image2", "text1", "audio1", "video2", "upscale:media1", "sticky-note:note1"]);
    expect(nodes.every((item) => item.identity === undefined)).toBe(true);
});

test("node numbers survive moves, title edits, generated contents and array reordering", () => {
    const original = [node("one"), node("two")];
    const assigned = assignCanvasNodeIdentities(original, original);
    const edited = assignCanvasNodeIdentities([{ ...assigned[1], title: "New prompt", metadata: { content: "new result" }, position: { x: 900, y: -300 } }, assigned[0]], assigned);
    expect(names(edited)).toEqual(["image2", "image1"]);
    expect(edited[0].metadata?.content).toBe("new result");
    expect(original[0].identity).toBeUndefined();
    expect(assignCanvasNodeIdentities(assigned, assigned)[0]).toBe(assigned[0]);
});

test("deleting an earlier node does not renumber survivors or renumber after reopening", () => {
    const original = [node("one"), node("two"), node("three")];
    const remaining = assignCanvasNodeIdentities([original[1], original[2]], original);
    expect(names(remaining)).toEqual(["image2", "image3"]);
    const reopened = JSON.parse(JSON.stringify(remaining)) as CanvasNodeData[];
    const appended = assignCanvasNodeIdentities([...reopened, node("four")], reopened);
    expect(names(appended)).toEqual(["image2", "image3", "image4"]);
});

test("replacing a node during generation retains its identity even if the replacement omits it", () => {
    const original = assignCanvasNodeIdentities([node("one"), node("two")], []);
    const regenerated = { ...node("two"), title: "A new generation prompt", metadata: { status: "loading" as const } };
    const assigned = assignCanvasNodeIdentities([original[0], regenerated], original);
    expect(assigned[1].identity).toBe(original[1].identity);
    expect(formatCanvasNodeName("图片", assigned[1].identity!)).toBe("图片2");
});

test("copies retain their source number and increase a single copy suffix", () => {
    let nodes = assignCanvasNodeIdentities([node("source"), node("second")], []);
    const copy = { ...nodes[0], id: "copy", identity: copiedCanvasNodeIdentity(nodes[0], nodes) };
    nodes = assignCanvasNodeIdentities([...nodes, copy], nodes);
    const copiedCopy = { ...copy, id: "copied-copy", identity: copiedCanvasNodeIdentity(copy, nodes) };
    nodes = assignCanvasNodeIdentities([...nodes, copiedCopy, node("third")], nodes);
    expect(names(nodes)).toEqual(["image1", "image2", "image1(2)", "image1(3)", "image3"]);
    expect(formatCanvasNodeName("图片", nodes[2].identity!)).toBe("图片1(2)");
    expect(nodes[2].metadata?.prompt).toBe("Keep the real prompt");
});

test("pasting multiple nodes from the same copy family does not duplicate names", () => {
    const source = node("source");
    let nodes = [source];
    for (const id of ["copy-a", "copy-b", "copy-c"]) {
        const copy = { ...source, id, identity: copiedCanvasNodeIdentity(source, nodes) };
        nodes = assignCanvasNodeIdentities([...nodes, copy], nodes);
    }
    expect(names(nodes)).toEqual(["image1", "image1(2)", "image1(3)", "image1(4)"]);
});

test("changing node type assigns a number from the actual new type", () => {
    const original = assignCanvasNodeIdentities([node("one"), node("video", "video")], []);
    const converted = assignCanvasNodeIdentities([{ ...original[0], type: "video" }, original[1]], original);
    expect(names(converted)).toEqual(["video2", "video1"]);
});

test("duplicate incoming identities receive unique names without touching node contents", () => {
    const original = assignCanvasNodeIdentities([node("one")], []);
    const concurrent = [{ ...original[0], id: "other" }, ...original];
    const assigned = assignCanvasNodeIdentities(concurrent, original);
    expect(names(assigned)).toEqual(["image2", "image1"]);
    expect(assigned[0].title).toBe("Prompt or filename");
    expect(assigned[0].metadata).toBe(original[0].metadata);
});

test("copying a clipboard node still works after its source is deleted", () => {
    const source = assignCanvasNodeIdentities([node("source")], [])[0];
    const copy = { ...source, id: "copy", identity: copiedCanvasNodeIdentity(source, []) };
    expect(names([copy])).toEqual(["image1(2)"]);
});

test("renaming every node type leaves automatic numbering independent of the chosen name", () => {
    for (const type of ["image", "video", "text", "audio", "group", "upscale:media", "sticky-note:note", "panorama:viewer"]) {
        const original = assignCanvasNodeIdentities([node("first", type)], []);
        const renamed = assignCanvasNodeIdentities([{ ...original[0], name: "图片999", title: "图片999" }, node("second", type)], original);
        expect(canvasNodeDisplayName(renamed[0], type, renamed[0].identity!)).toBe("图片999");
        expect(canvasNodeDisplayName(renamed[1], type, renamed[1].identity!)).toBe(`${type}2`);
        expect(renamed[0].identity).toBe(original[0].identity);
        expect(renamed[0].metadata).toBe(original[0].metadata);
    }
});

test("asset names display exactly while their hidden number still reserves the next type index", () => {
    const asset = { ...node("asset"), name: "主角三视图", title: "主角三视图" };
    const nodes = assignCanvasNodeIdentities([node("first"), asset, node("third")], []);
    expect(canvasNodeDisplayName(nodes[1], "图片", nodes[1].identity!)).toBe("主角三视图");
    expect(canvasNodeDisplayName(nodes[2], "图片", nodes[2].identity!)).toBe("图片3");
    expect(nodes[1].identity?.number).toBe(2);
});

test("custom names survive regenerated objects and reopening without altering prompts", () => {
    const named = assignCanvasNodeIdentities([{ ...node("source"), name: "片头配音", title: "片头配音" }], []);
    const generated = assignCanvasNodeIdentities([{ ...node("source"), title: "New generation prompt" }], named);
    expect(generated[0].name).toBe("片头配音");
    expect(generated[0].title).toBe("片头配音");
    expect(generated[0].metadata?.prompt).toBe("Keep the real prompt");
    const reopened = JSON.parse(JSON.stringify(generated)) as CanvasNodeData[];
    expect(canvasNodeDisplayName(reopened[0], "图片", canvasNodeIdentities(reopened).get("source")!)).toBe("片头配音");
});

test("copies of named assets and renamed nodes retain one incrementing suffix", () => {
    const nodes = assignCanvasNodeIdentities([{ ...node("asset"), name: "角色设定", title: "角色设定" }], []);
    const identity = copiedCanvasNodeIdentity(nodes[0], nodes)!;
    const copy = { ...nodes[0], id: "copy", identity, name: copiedCanvasNodeName(nodes[0], identity) };
    const assigned = assignCanvasNodeIdentities([...nodes, copy], nodes);
    expect(assigned[1].name).toBe("角色设定(2)");
    expect(assigned[1].title).toBe("角色设定(2)");
    expect(copiedCanvasNodeName(assigned[1], copiedCanvasNodeIdentity(assigned[1], assigned))).toBe("角色设定(3)");
    expect(copiedCanvasNodeName(node("automatic"), identity)).toBeUndefined();
});
