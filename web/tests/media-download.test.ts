import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ saveAs: vi.fn(), assetBlob: vi.fn(), assertSession: vi.fn() }));
vi.mock("file-saver", () => ({ saveAs: mocks.saveAs }));
vi.mock("@/i18n", () => ({ default: { t: (key: string) => key } }));
vi.mock("@/services/api/client", () => ({ captureSession: () => mocks.assertSession }));
vi.mock("@/services/api/assets", () => ({
    assetBlob: mocks.assetBlob,
    assetId: (key = "") => key.startsWith("asset:") ? key.slice(6) : /^\/api\/assets\/([^/]+)\/(?:file|preview)$/.exec(key)?.[1],
}));

import { downloadMediaFile } from "../src/services/media-download";

const fetchMock = vi.fn();
beforeEach(() => { vi.resetAllMocks(); vi.stubGlobal("fetch", fetchMock); });

test.each([
    ["image/jpeg", "jpg"], ["image/webp", "webp"], ["image/avif", "avif"], ["image/svg+xml", "svg"],
    ["video/mp4", "mp4"], ["video/webm", "webm"], ["video/quicktime", "mov"],
    ["audio/mpeg", "mp3"], ["audio/wav", "wav"], ["audio/x-wav", "wav"], ["audio/ogg", "oga"], ["audio/flac", "flac"], ["audio/pcm", "pcm"], ["audio/opus", "opus"],
])("downloads the original blob with an extension matching %s", async (type, extension) => {
    const blob = new Blob(["original bytes"], { type });
    mocks.assetBlob.mockResolvedValue(blob);
    await downloadMediaFile({ url: "/api/assets/original/file", mimeType: "image/png" }, "canvas-resource");
    expect(mocks.assetBlob).toHaveBeenCalledWith("original");
    expect(mocks.saveAs).toHaveBeenCalledWith(blob, `canvas-resource.${extension}`);
    expect(fetchMock).not.toHaveBeenCalled();
});

test("uses the stable asset instead of a preview or stale content URL", async () => {
    const blob = new Blob(["original"], { type: "image/png" });
    mocks.assetBlob.mockResolvedValue(blob);
    await downloadMediaFile({ url: "/api/assets/preview/preview", storageKey: "asset:original" }, "batch-image");
    expect(mocks.assetBlob).toHaveBeenCalledWith("original");
    expect(mocks.saveAs).toHaveBeenCalledWith(blob, "batch-image.png");
});

test("resolves preview downloads to the full original file", async () => {
    mocks.assetBlob.mockResolvedValue(new Blob(["original"], { type: "image/jpeg" }));
    await downloadMediaFile({ url: "/api/assets/original/preview" }, "reference");
    expect(mocks.assetBlob).toHaveBeenCalledWith("original");
    expect(mocks.saveAs).toHaveBeenCalledWith(expect.any(Blob), "reference.jpg");
});

test.each([["photo.jpg", "photo.jpg"], ["photo.jpeg", "photo.jpeg"], ["photo.png", "photo.jpg"], ["scene.v2", "scene.v2.jpg"], ["folder/photo", "folder_photo.jpg"]])("normalizes the filename %s without duplicating a media extension", async (name, expected) => {
    mocks.assetBlob.mockResolvedValue(new Blob(["image"], { type: "image/jpeg" }));
    await downloadMediaFile({ url: "/api/assets/original/file" }, name);
    expect(mocks.saveAs).toHaveBeenCalledWith(expect.any(Blob), expected);
});

test("falls back to the recorded MIME type when the response type is generic", async () => {
    mocks.assetBlob.mockResolvedValue(new Blob(["video"], { type: "application/octet-stream" }));
    await downloadMediaFile({ url: "/api/assets/original/file", mimeType: "video/webm" }, "video");
    expect(mocks.saveAs).toHaveBeenCalledWith(expect.any(Blob), "video.webm");
});

test("uses bin instead of guessing a media format when the MIME type is unknown", async () => {
    mocks.assetBlob.mockResolvedValue(new Blob(["unknown"], { type: "application/x-unknown" }));
    await downloadMediaFile({ url: "/api/assets/original/file" }, "file");
    expect(mocks.saveAs).toHaveBeenCalledWith(expect.any(Blob), "file.bin");
});

test.each(["blob:reference", "data:image/webp;base64,reference"])("downloads local previews by their actual type: %s", async (url) => {
    const blob = new Blob(["image"], { type: "image/webp" });
    fetchMock.mockResolvedValue({ ok: true, blob: async () => blob });
    await downloadMediaFile({ url }, "reference");
    expect(mocks.saveAs).toHaveBeenCalledWith(blob, "reference.webp");
});

test("does not save an error response as a media file", async () => {
    fetchMock.mockResolvedValue({ ok: false });
    await expect(downloadMediaFile({ url: "blob:missing" }, "reference")).rejects.toThrow("assets.downloadFailed");
    expect(mocks.saveAs).not.toHaveBeenCalled();
});

test("does not save deleted or unreadable assets", async () => {
    mocks.assetBlob.mockRejectedValue(new Error("asset deleted"));
    await expect(downloadMediaFile({ url: "/api/assets/missing/file" }, "image")).rejects.toThrow("asset deleted");
    expect(mocks.saveAs).not.toHaveBeenCalled();
});

test("does not start a download after the account changes", async () => {
    mocks.assetBlob.mockResolvedValue(new Blob(["image"], { type: "image/png" }));
    mocks.assertSession.mockImplementation(() => { throw new Error("session changed"); });
    await expect(downloadMediaFile({ url: "/api/assets/original/file" }, "image")).rejects.toThrow("session changed");
    expect(mocks.saveAs).not.toHaveBeenCalled();
});
