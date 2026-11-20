import { beforeEach, expect, test, vi } from "vitest";
import type { CanvasProject } from "../src/stores/canvas/use-canvas-store";

const mocks = vi.hoisted(() => ({
    drafts: new Map<string, unknown>(), save: vi.fn(), list: vi.fn(), read: vi.fn(), write: vi.fn(), revert: vi.fn(),
}));
vi.mock("@/i18n", () => ({ default: { t: (key: string) => key } }));
vi.mock("@/stores/use-auth-store", () => ({ useAuthStore: { getState: () => ({ user: { id: "user" } }) } }));
vi.mock("@/services/api/projects", () => ({
    saveProject: mocks.save, listProjects: mocks.list, getProject: mocks.read, revertProject: mocks.revert,
    projectHistory: async () => ({ head: 100, past: [], future: [] }),
}));
vi.mock("localforage", () => ({ default: { createInstance: () => ({
    setItem: async (key: string, value: unknown) => { await mocks.write(); mocks.drafts.set(key, value); },
    removeItem: async (key: string) => { mocks.drafts.delete(key); },
    iterate: async (visit: (value: unknown, key: string) => void) => { for (const [key, value] of mocks.drafts) visit(value, key); },
}) } }));
vi.stubGlobal("sessionStorage", { getItem: () => "test-tab", setItem: () => {} });
vi.stubGlobal("navigator", { locks: { request: (_name: string, _options: unknown, callback: (lock: object) => Promise<void>) => callback({}) } });
const { useCanvasStore } = await import("../src/stores/canvas/use-canvas-store");

const project = (): CanvasProject => ({ id: "p", title: "Canvas", version: 1, createdAt: "2026-11-19T00:00:00Z", updatedAt: "2026-11-19T00:00:00Z", nodes: [{ id: "a", type: "text", title: "A", position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { content: "base", status: "success" } }], connections: [], chatSessions: [], activeChatId: null, backgroundMode: "lines", showImageInfo: false, viewport: { x: 0, y: 0, k: 1 } });
function mount() {
    const base = project();
    useCanvasStore.setState({ hydrated: true, projects: [base], bases: { p: base }, saves: {}, histories: {}, error: "" });
    return base;
}
beforeEach(() => {
    vi.clearAllMocks(); mocks.drafts.clear(); useCanvasStore.getState().reset();
    mocks.save.mockImplementation(async (value: CanvasProject) => ({ ...value, version: value.version + 1 }));
    mocks.write.mockResolvedValue(undefined);
});

test("edits made while a save is pending survive a server result and are saved again", async () => {
    const base = mount();
    let complete!: (value: CanvasProject) => void;
    mocks.save.mockImplementationOnce(() => new Promise<CanvasProject>((resolve) => { complete = resolve; }));
    useCanvasStore.getState().updateProject("p", { nodes: [{ ...base.nodes[0], position: { x: 40, y: 0 } }] });
    await vi.waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    const sent = mocks.save.mock.calls[0][0] as CanvasProject;
    useCanvasStore.getState().updateProject("p", { title: "typed during save" });
    complete({ ...sent, version: 3, nodes: [{ ...sent.nodes[0], metadata: { content: "assistant", status: "success" } }] });
    const saved = await useCanvasStore.getState().ensureSaved("p");
    expect(saved.title).toBe("typed during save");
    expect(saved.nodes[0].metadata?.content).toBe("assistant");
    expect(saved.nodes[0].position.x).toBe(40);
    expect(mocks.save).toHaveBeenCalledTimes(2);
    expect(mocks.drafts.size).toBe(0);
});

test("a remote notification newer than an in-flight save is fetched after the save", async () => {
    const base = mount();
    let complete!: (value: CanvasProject) => void;
    mocks.save.mockImplementationOnce(() => new Promise<CanvasProject>((resolve) => { complete = resolve; }));
    useCanvasStore.getState().updateProject("p", { title: "moved" });
    await vi.waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    const sent = mocks.save.mock.calls[0][0] as CanvasProject;
    const remote = { ...sent, version: 3, nodes: [{ ...base.nodes[0], metadata: { content: "task finished", status: "success" as const } }] };
    mocks.list.mockResolvedValue([remote]); mocks.read.mockResolvedValue(remote);
    await useCanvasStore.getState().refreshProjects();
    complete({ ...sent, version: 2 });
    await useCanvasStore.getState().ensureSaved("p");
    await vi.waitFor(() => expect(useCanvasStore.getState().bases.p.version).toBe(3));
    expect(useCanvasStore.getState().openProject("p")?.nodes[0].metadata?.content).toBe("task finished");
    expect(useCanvasStore.getState().saves.p.status).toBe("saved");
});

test("retry recovers a failed local draft write without dropping edits", async () => {
    mount(); mocks.write.mockRejectedValueOnce(new Error("disk failed"));
    useCanvasStore.getState().updateProject("p", { title: "preserved" });
    await vi.waitFor(() => expect(useCanvasStore.getState().saves.p.status).toBe("error"));
    expect(mocks.save).not.toHaveBeenCalled();
    await useCanvasStore.getState().retrySave("p");
    expect(useCanvasStore.getState().openProject("p")?.title).toBe("preserved");
    expect(useCanvasStore.getState().saves.p.status).toBe("saved");
});

test("a failed save restores its draft against fresh server content after reopening", async () => {
    const base = mount(); mocks.save.mockRejectedValueOnce(new Error("offline"));
    useCanvasStore.getState().updateProject("p", { title: "local draft" });
    await vi.waitFor(() => expect(useCanvasStore.getState().saves.p.status).toBe("error"));
    useCanvasStore.getState().reset();
    mocks.list.mockResolvedValue([{ ...base, version: 2, nodes: [{ ...base.nodes[0], metadata: { content: "remote task", status: "success" } }] }]);
    await useCanvasStore.getState().loadProjects();
    const saved = await useCanvasStore.getState().ensureSaved("p");
    expect(saved.title).toBe("local draft");
    expect(saved.nodes[0].metadata?.content).toBe("remote task");
    expect(mocks.drafts.size).toBe(0);
});

test("an undo notification arriving before its HTTP response does not apply deletions twice", async () => {
    const base = mount();
    useCanvasStore.setState({ histories: { p: { head: 1, past: [2], future: [] } } });
    let complete!: (value: CanvasProject) => void;
    mocks.revert.mockImplementationOnce(() => new Promise<CanvasProject>((resolve) => { complete = resolve; }));
    const undo = useCanvasStore.getState().undo("p");
    await vi.waitFor(() => expect(mocks.revert).toHaveBeenCalledTimes(1));
    const undone = { ...base, version: 3, nodes: [] };
    mocks.list.mockResolvedValue([undone]);
    await useCanvasStore.getState().refreshProjects();
    complete(undone); await undo;
    expect(useCanvasStore.getState().openProject("p")?.nodes).toEqual([]);
    expect(useCanvasStore.getState().bases.p.version).toBe(3);
    expect(mocks.save).not.toHaveBeenCalled();
});

test("drag updates save with one operation ID and the next edit has a separate ID", async () => {
    const base = mount();
    useCanvasStore.getState().beginOperation("p");
    useCanvasStore.getState().updateProject("p", { nodes: [{ ...base.nodes[0], position: { x: 10, y: 0 } }] });
    await useCanvasStore.getState().ensureSaved("p");
    useCanvasStore.getState().updateProject("p", { nodes: [{ ...base.nodes[0], position: { x: 80, y: 0 } }] });
    await useCanvasStore.getState().ensureSaved("p");
    useCanvasStore.getState().endOperation("p");
    useCanvasStore.getState().updateProject("p", { title: "renamed" });
    await useCanvasStore.getState().ensureSaved("p");
    const ids = mocks.save.mock.calls.map((call) => call[1]);
    expect(ids[0]).toBeTruthy(); expect(ids[1]).toBe(ids[0]); expect(ids[2]).not.toBe(ids[0]);
});

test("remote project deletion preserves a failed local draft as a visible conflict", async () => {
    mount(); mocks.save.mockRejectedValueOnce(new Error("offline"));
    useCanvasStore.getState().updateProject("p", { title: "preserve after deletion" });
    await vi.waitFor(() => expect(useCanvasStore.getState().saves.p.status).toBe("error"));
    mocks.list.mockResolvedValue([]);
    await useCanvasStore.getState().refreshProjects();
    expect(useCanvasStore.getState().openProject("p")?.title).toBe("preserve after deletion");
    expect(useCanvasStore.getState().saves.p.status).toBe("conflict");
    expect(mocks.drafts.size).toBe(1);
});

test("node identities save with content edits and survive regenerated node objects", async () => {
    const base = mount();
    useCanvasStore.getState().updateProject("p", { nodes: [...base.nodes, { ...base.nodes[0], id: "second", title: "A second prompt" }] });
    const saved = await useCanvasStore.getState().ensureSaved("p");
    expect(saved.nodes.map((node) => node.identity)).toEqual([{ type: "text", number: 1, copy: 1 }, { type: "text", number: 2, copy: 1 }]);
    useCanvasStore.getState().updateProject("p", { nodes: [{ ...base.nodes[0], id: "second", title: "Regenerated prompt", metadata: { content: "generated", status: "success" } }] });
    const regenerated = await useCanvasStore.getState().ensureSaved("p");
    expect(regenerated.nodes[0].identity).toEqual({ type: "text", number: 2, copy: 1 });
    expect(regenerated.nodes[0].metadata?.content).toBe("generated");
    expect(regenerated.nodes[0].title).toBe("Regenerated prompt");
});

test("renaming and asset names persist separately from the next automatic node number", async () => {
    const base = mount();
    useCanvasStore.getState().updateProject("p", { nodes: [{ ...base.nodes[0], name: "主角台词", title: "主角台词" }, { ...base.nodes[0], id: "asset", name: "资产库剧本", title: "资产库剧本" }] });
    const named = await useCanvasStore.getState().ensureSaved("p");
    useCanvasStore.getState().updateProject("p", { nodes: [{ ...base.nodes[0], title: "New generated title" }, named.nodes[1], { ...base.nodes[0], id: "new" }] });
    const saved = await useCanvasStore.getState().ensureSaved("p");
    expect(saved.nodes.map((node) => node.name)).toEqual(["主角台词", "资产库剧本", undefined]);
    expect(saved.nodes.map((node) => node.identity?.number)).toEqual([1, 2, 3]);
    expect(saved.nodes[0].title).toBe("主角台词");
    expect(saved.nodes[0].metadata?.prompt).toBeUndefined();
});
