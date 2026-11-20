import { beforeEach, expect, test, vi } from "vitest";
import type { GenerationTask } from "../src/services/api/tasks";
import type { AiConfig } from "../src/stores/use-config-store";

const mocks = vi.hoisted(() => ({ request: vi.fn(), sync: vi.fn(), decode: vi.fn(), parameters: vi.fn() }));
vi.mock("@/i18n", () => ({ default: { t: (key: string) => key } }));
vi.mock("@/services/api/client", () => ({ apiRequest: mocks.request, captureSession: () => () => {}, jsonRequest: (method: string, body: unknown) => ({ method, body: JSON.stringify(body) }) }));
vi.mock("@/services/api/assets", () => ({ assetId: () => undefined }));
vi.mock("@/stores/use-config-store", () => ({ decodeChannelModel: mocks.decode, resolveModelParameters: mocks.parameters }));
vi.mock("@/lib/model-inputs", () => ({ inputLabel: vi.fn(), inputVisible: vi.fn() }));
vi.mock("@/stores/canvas/use-canvas-store", () => ({ useCanvasStore: { getState: () => ({ acceptTaskVersion: mocks.sync }) } }));

class TaskEvents extends EventTarget {
    static CLOSED = 2;
    static latest: TaskEvents;
    readyState = 1;
    onopen?: () => void;
    onerror?: () => void;
    constructor(readonly url: string) { super(); TaskEvents.latest = this; }
    close() { this.readyState = TaskEvents.CLOSED; }
    snapshot(task: GenerationTask) { this.dispatchEvent(Object.assign(new Event("snapshot"), { data: JSON.stringify(task) })); }
}
vi.stubGlobal("EventSource", TaskEvents);
const { createGeneration, waitForGeneration } = await import("../src/services/api/tasks");
const { canvasGenerationProgress, canvasGenerationTask, useGenerationProgressStore } = await import("../src/stores/use-generation-progress-store");
const task = (patch: Partial<GenerationTask> = {}) => ({ id: "task", projectId: "p", nodeId: "n", status: "running", updatedAt: "2026-11-19T00:00:00Z", text: "", input: {}, applied: false, ...patch }) as GenerationTask;
beforeEach(() => { vi.clearAllMocks(); mocks.sync.mockResolvedValue(undefined); useGenerationProgressStore.setState({ tasks: {}, requests: [], loaded: false }); });

test("reconnecting reads a finished server task and syncs its result without generation submission", async () => {
    const waiting = waitForGeneration(task({ projectId: undefined, nodeId: undefined }));
    const finished = task({ projectId: undefined, nodeId: undefined, status: "succeeded", applied: true, updatedAt: "2026-11-19T00:01:00Z" });
    mocks.request.mockResolvedValue(finished);
    TaskEvents.latest.onopen?.();
    expect(await waiting).toEqual(finished);
    expect(mocks.request).toHaveBeenCalledWith("/tasks/task", { signal: undefined });
    expect(mocks.sync).not.toHaveBeenCalled();
    expect(TaskEvents.latest.readyState).toBe(TaskEvents.CLOSED);
});

test("leaving during result synchronization aborts only the page waiter and keeps the finished task", async () => {
    let complete!: () => void;
    mocks.sync.mockImplementationOnce(() => new Promise<void>((resolve) => { complete = resolve; }));
    const controller = new AbortController();
    const waiting = waitForGeneration(task(), { signal: controller.signal });
    const rejected = expect(waiting).rejects.toMatchObject({ name: "AbortError" });
    useGenerationProgressStore.getState().receive(task({ status: "succeeded", applied: true, updatedAt: "2026-11-19T00:01:00Z" }));
    controller.abort(); complete(); await rejected;
    expect(useGenerationProgressStore.getState().tasks.task.status).toBe("succeeded");
    expect(mocks.request).not.toHaveBeenCalled();
});

test("an older snapshot cannot roll task progress back after reconnecting", async () => {
    const waiting = waitForGeneration(task({ updatedAt: "2026-11-19T00:01:00Z", progress: 80 }));
    useGenerationProgressStore.getState().receive(task({ progress: 20 }));
    expect(useGenerationProgressStore.getState().tasks.task.progress).toBe(80);
    useGenerationProgressStore.getState().receive(task({ status: "succeeded", applied: true, updatedAt: "2026-11-19T00:02:00Z" }));
    await waiting;
});

test("canvas tasks share the global subscription without opening another event connection", async () => {
    const previous = TaskEvents.latest;
    const waiting = waitForGeneration(task());
    expect(TaskEvents.latest).toBe(previous);
    useGenerationProgressStore.getState().receive(task({ status: "succeeded", applied: true, updatedAt: "2026-11-19T00:01:00Z" }));
    await waiting;
    expect(mocks.sync).toHaveBeenCalledWith("task", "p", "n");
});

test.each(["text", "image", "video", "audio"] as const)("a new %s request stays submitting before its task exists, then shows the actual server state", (capability) => {
    useGenerationProgressStore.setState({ loaded: true });
    const controller = new AbortController();
    useGenerationProgressStore.getState().startRequest("p", "n", controller.signal);
    expect(canvasGenerationProgress(useGenerationProgressStore.getState(), "p", "n")?.status || "submitting").toBe("submitting");
    for (const status of ["queued", "waiting_assets", "submitting", "running", "saving"]) {
        useGenerationProgressStore.getState().receive(task({ capability, status }), controller.signal);
        expect(canvasGenerationProgress(useGenerationProgressStore.getState(), "p", "n")?.status).toBe(status);
    }
    useGenerationProgressStore.getState().finishRequest("p", "n", controller.signal);
    expect(canvasGenerationProgress(useGenerationProgressStore.getState(), "p", "n")?.status).toBe("saving");
});

test.each(["failed", "interrupted", "cancelled", "succeeded", "confirmation_required", "disconnected"])("retrying does not reuse an old %s task or its text", (status) => {
    useGenerationProgressStore.setState({ loaded: true });
    useGenerationProgressStore.getState().receive(task({ status, text: "old output", input: { resultSlotId: "slot" } }));
    const controller = new AbortController();
    useGenerationProgressStore.getState().startRequest("p", "n", controller.signal);
    expect(canvasGenerationTask(useGenerationProgressStore.getState(), "p", "n", "slot")).toBeUndefined();
    expect(canvasGenerationProgress(useGenerationProgressStore.getState(), "p", "n", "slot")?.status || "submitting").toBe("submitting");
    const current = task({ id: "retry", input: { resultSlotId: "slot" }, updatedAt: "2026-11-19T00:02:00Z", createdAt: "2026-11-19T00:02:00Z" });
    useGenerationProgressStore.getState().receive(current, controller.signal);
    useGenerationProgressStore.getState().startRequest("p", "n", controller.signal);
    expect(canvasGenerationTask(useGenerationProgressStore.getState(), "p", "n", "slot")).toBe(current);
    expect(canvasGenerationTask(useGenerationProgressStore.getState(), "p", "n", "other-slot")).toBeUndefined();
});

test("local requests preserve real interruption states and do not mask unrelated orphaned nodes", () => {
    useGenerationProgressStore.setState({ loaded: true });
    const controller = new AbortController();
    useGenerationProgressStore.getState().startRequest("p", "n", controller.signal);
    expect(canvasGenerationProgress(useGenerationProgressStore.getState(), "p", "other")?.status).toBe("interrupted");
    expect(canvasGenerationProgress(useGenerationProgressStore.getState(), "other", "n")?.status).toBe("interrupted");
    useGenerationProgressStore.getState().receive(task({ status: "interrupted", error: "server stopped" }), controller.signal);
    expect(canvasGenerationProgress(useGenerationProgressStore.getState(), "p", "n")).toMatchObject({ status: "interrupted", error: "server stopped" });
    useGenerationProgressStore.getState().finishRequest("p", "n", controller.signal);
    expect(canvasGenerationProgress(useGenerationProgressStore.getState(), "p", "n")?.status).toBe("interrupted");
});

test("finishing an older request cannot clear a replacement request", () => {
    useGenerationProgressStore.setState({ loaded: true });
    const first = new AbortController();
    const replacement = new AbortController();
    useGenerationProgressStore.getState().startRequest("p", "n", first.signal);
    useGenerationProgressStore.getState().startRequest("p", "n", replacement.signal);
    useGenerationProgressStore.getState().finishRequest("p", "n", first.signal);
    expect(canvasGenerationProgress(useGenerationProgressStore.getState(), "p", "n")).toBeUndefined();
    useGenerationProgressStore.getState().finishRequest("p", "n", replacement.signal);
    expect(canvasGenerationProgress(useGenerationProgressStore.getState(), "p", "n")?.status).toBe("interrupted");
});

test("restoring an existing active video task keeps its actual progress", () => {
    const running = task({ capability: "video", progress: 60, createdAt: "2026-11-19T00:00:00Z" });
    useGenerationProgressStore.getState().receive(running);
    useGenerationProgressStore.getState().startRequest("p", "n", new AbortController().signal, running.id);
    expect(canvasGenerationTask(useGenerationProgressStore.getState(), "p", "n")).toBe(running);
    expect(canvasGenerationProgress(useGenerationProgressStore.getState(), "p", "n")).toMatchObject({ status: "running", progress: 60 });
});

test("a task received before its acceptance response is bound atomically without rolling progress back", async () => {
    useGenerationProgressStore.setState({ loaded: true });
    mocks.decode.mockReturnValue({ channelId: "channel", model: "tts" });
    mocks.parameters.mockReturnValue({});
    const config = { model: "tts", channels: [{ id: "channel", models: [{ id: "model", name: "tts", capability: "audio", parameters: [] }] }] } as unknown as AiConfig;
    const controller = new AbortController();
    useGenerationProgressStore.getState().startRequest("p", "n", controller.signal);
    let accept!: (record: GenerationTask) => void;
    mocks.request.mockImplementationOnce(() => new Promise<GenerationTask>((resolve) => { accept = resolve; }));
    const submitting = createGeneration(config, "audio", { prompt: "tts" }, { projectId: "p", nodeId: "n", signal: controller.signal });
    const active = task({ capability: "audio", createdAt: "2026-11-19T00:00:00Z", updatedAt: "2026-11-19T00:01:00Z" });
    useGenerationProgressStore.getState().receive(active);
    expect(canvasGenerationProgress(useGenerationProgressStore.getState(), "p", "n")).toBeUndefined();
    accept(task({ capability: "audio", status: "queued" }));
    await submitting;
    expect(canvasGenerationTask(useGenerationProgressStore.getState(), "p", "n")).toBe(active);
    expect(canvasGenerationProgress(useGenerationProgressStore.getState(), "p", "n")?.status).toBe("running");
});

test("a late response from an older request cannot replace the current request's task", () => {
    useGenerationProgressStore.setState({ loaded: true });
    const first = new AbortController();
    const current = new AbortController();
    useGenerationProgressStore.getState().startRequest("p", "n", first.signal);
    useGenerationProgressStore.getState().startRequest("p", "n", current.signal);
    useGenerationProgressStore.getState().receive(task(), first.signal);
    expect(canvasGenerationTask(useGenerationProgressStore.getState(), "p", "n")).toBeUndefined();
    const accepted = task({ id: "current", createdAt: "2026-11-19T00:01:00Z" });
    useGenerationProgressStore.getState().receive(accepted, current.signal);
    expect(canvasGenerationTask(useGenerationProgressStore.getState(), "p", "n")).toBe(accepted);
});
