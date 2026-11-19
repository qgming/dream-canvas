import { beforeEach, expect, test, vi } from "vitest";
import type { GenerationTask } from "../src/services/api/tasks";

const mocks = vi.hoisted(() => ({ request: vi.fn(), sync: vi.fn() }));
vi.mock("@/i18n", () => ({ default: { t: (key: string) => key } }));
vi.mock("@/services/api/client", () => ({ apiRequest: mocks.request, captureSession: () => () => {}, jsonRequest: (method: string, body: unknown) => ({ method, body: JSON.stringify(body) }) }));
vi.mock("@/services/api/assets", () => ({ assetId: () => undefined }));
vi.mock("@/stores/use-config-store", () => ({ decodeChannelModel: vi.fn(), resolveModelParameters: vi.fn() }));
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
const { waitForGeneration } = await import("../src/services/api/tasks");
const { useGenerationProgressStore } = await import("../src/stores/use-generation-progress-store");
const task = (patch: Partial<GenerationTask> = {}) => ({ id: "task", projectId: "p", nodeId: "n", status: "running", updatedAt: "2026-11-19T00:00:00Z", text: "", input: {}, applied: false, ...patch }) as GenerationTask;
beforeEach(() => { vi.clearAllMocks(); mocks.sync.mockResolvedValue(undefined); useGenerationProgressStore.setState({ tasks: {} }); });

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
