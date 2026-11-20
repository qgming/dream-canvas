import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ Recorder: vi.fn(), register: vi.fn(), connect: vi.fn(), disconnect: vi.fn(), port: { close: vi.fn() } }));
vi.mock("extendable-media-recorder", () => ({ MediaRecorder: mocks.Recorder, register: mocks.register }));
vi.mock("extendable-media-recorder-wav-encoder", () => ({ connect: mocks.connect, disconnect: mocks.disconnect }));

beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.connect.mockResolvedValue(mocks.port);
    mocks.register.mockResolvedValue(undefined);
    mocks.disconnect.mockResolvedValue(undefined);
});

test("concurrent recording sessions share a single WAV encoder registration", async () => {
    const { loadWavRecorder } = await import("../src/lib/canvas/canvas-audio-recording");
    const first = loadWavRecorder();
    expect(loadWavRecorder()).toBe(first);
    expect(await first).toBe(mocks.Recorder);
    expect(await loadWavRecorder()).toBe(mocks.Recorder);
    expect(mocks.connect).toHaveBeenCalledTimes(1);
    expect(mocks.register).toHaveBeenCalledExactlyOnceWith(mocks.port);
    expect(mocks.disconnect).not.toHaveBeenCalled();
});

test("failed WAV registration releases its port and allows an explicit retry", async () => {
    mocks.register.mockRejectedValueOnce(new Error("registration failed"));
    const { loadWavRecorder } = await import("../src/lib/canvas/canvas-audio-recording");
    await expect(loadWavRecorder()).rejects.toThrow("registration failed");
    expect(mocks.disconnect).toHaveBeenCalledExactlyOnceWith(mocks.port);
    expect(mocks.port.close).toHaveBeenCalledTimes(1);
    expect(await loadWavRecorder()).toBe(mocks.Recorder);
    expect(mocks.connect).toHaveBeenCalledTimes(2);
    expect(mocks.register).toHaveBeenCalledTimes(2);
});

test("failed encoder connection does not silently fall back to WebM", async () => {
    mocks.connect.mockRejectedValueOnce(new Error("worker unavailable"));
    const { loadWavRecorder } = await import("../src/lib/canvas/canvas-audio-recording");
    await expect(loadWavRecorder()).rejects.toThrow("worker unavailable");
    expect(mocks.register).not.toHaveBeenCalled();
    expect(await loadWavRecorder()).toBe(mocks.Recorder);
    expect(mocks.register).toHaveBeenCalledTimes(1);
});
