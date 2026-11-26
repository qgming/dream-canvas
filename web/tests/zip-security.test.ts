import { afterAll, expect, test } from "vitest";
import { zipSync } from "fflate";

const values = new Map<string, string>();
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
    },
});
afterAll(() => {
    if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
});

const {
    MEDIA_ZIP_LIMITS,
    SCRIPT_ZIP_LIMITS,
    ZipLimitError,
    createZip,
    isSafeZipEntryPath,
    readZip,
    readZipEntries,
} = await import("../src/lib/zip");

test("isSafeZipEntryPath rejects traversal, absolute paths, drive letters, and control characters", () => {
    expect(isSafeZipEntryPath("assets/a.png")).toBe(true);
    expect(isSafeZipEntryPath("dir/sub/file.json")).toBe(true);
    expect(isSafeZipEntryPath("dir/")).toBe(true);

    expect(isSafeZipEntryPath("")).toBe(false);
    expect(isSafeZipEntryPath("/etc/passwd")).toBe(false);
    expect(isSafeZipEntryPath("\\windows\\win.ini")).toBe(false);
    expect(isSafeZipEntryPath("../escape.txt")).toBe(false);
    expect(isSafeZipEntryPath("a/../../escape.txt")).toBe(false);
    expect(isSafeZipEntryPath("./hidden.txt")).toBe(false);
    expect(isSafeZipEntryPath("C:foo.txt")).toBe(false);
    expect(isSafeZipEntryPath("a\\b.txt")).toBe(false);
    expect(isSafeZipEntryPath("a\u0000b.txt")).toBe(false);
    expect(isSafeZipEntryPath("a\nb.txt")).toBe(false);
});

test("readZipEntries round-trips safe archives and rejects path traversal entries", async () => {
    const safeBlob = await createZip([
        { name: "manifest.json", data: JSON.stringify({ ok: true }) },
        { name: "files/hello.txt", data: "world" },
    ]);
    const entries = await readZip(safeBlob, SCRIPT_ZIP_LIMITS);
    expect(await entries.get("files/hello.txt")?.text()).toBe("world");

    const maliciousBytes = zipSync({ "../evil.txt": new TextEncoder().encode("boom") }, { level: 0 });
    const maliciousBlob = new Blob([maliciousBytes as Uint8Array<ArrayBuffer>], { type: "application/zip" });
    await expect(readZipEntries(maliciousBlob, SCRIPT_ZIP_LIMITS)).rejects.toBeInstanceOf(ZipLimitError);
});

test("readZipEntries enforces maxFiles, maxEntryBytes, and maxTotalBytes", async () => {
    const many = await createZip([
        { name: "a.txt", data: "1" },
        { name: "b.txt", data: "2" },
        { name: "c.txt", data: "3" },
    ]);
    await expect(readZipEntries(many, { maxFiles: 2, maxEntryBytes: 1024, maxTotalBytes: 4096 })).rejects.toBeInstanceOf(ZipLimitError);

    const bigEntry = await createZip([{ name: "big.bin", data: new Uint8Array(256) }]);
    await expect(readZipEntries(bigEntry, { maxFiles: 10, maxEntryBytes: 128, maxTotalBytes: 4096 })).rejects.toBeInstanceOf(ZipLimitError);

    const bigTotal = await createZip([
        { name: "1.bin", data: new Uint8Array(100) },
        { name: "2.bin", data: new Uint8Array(100) },
    ]);
    await expect(readZipEntries(bigTotal, { maxFiles: 10, maxEntryBytes: 150, maxTotalBytes: 150 })).rejects.toBeInstanceOf(ZipLimitError);

    // Ensure MEDIA_ZIP_LIMITS matches the confirmed 2 GiB / 5000-file boundary.
    expect(MEDIA_ZIP_LIMITS.maxFiles).toBe(5000);
    expect(MEDIA_ZIP_LIMITS.maxEntryBytes).toBe(2 * 1024 * 1024 * 1024);
    expect(MEDIA_ZIP_LIMITS.maxTotalBytes).toBe(2 * 1024 * 1024 * 1024);
});
