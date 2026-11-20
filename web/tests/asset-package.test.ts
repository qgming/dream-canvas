import { expect, test, vi } from "vitest";
import type { ServerAsset } from "../src/services/api/assets";

vi.mock("@/services/api/assets", () => ({ assetId: (value?: string) => value?.startsWith("asset:") ? value.slice(6) : value?.match(/^\/api\/assets\/([^/]+)\//)?.[1], assetUrl: (id: string) => `/api/assets/${id}/file` }));

const { collectPackageAssets, replacePackageAssets } = await import("../src/lib/canvas/asset-package");

test("custom names are text even when they look like asset references", () => {
    for (const name of ["asset:missing", "/api/assets/missing/file", "主角三视图"]) {
        const project = { nodes: [{ name, metadata: { content: "/api/assets/actual/file", storageKey: "asset:actual" } }] };
        expect([...collectPackageAssets(project)]).toEqual(["asset:actual"]);
    }
});

test("importing assets replaces media references but preserves custom node names", () => {
    for (const name of ["asset:original", "/api/assets/original/file"]) {
        const project = { nodes: [{ name, metadata: { content: "/api/assets/original/file", storageKey: "asset:original" } }] };
        const imported = replacePackageAssets(project, new Map([["asset:original", { id: "imported" } as ServerAsset]]));
        expect(imported.nodes[0].name).toBe(name);
        expect(imported.nodes[0].metadata).toEqual({ content: "/api/assets/imported/file", storageKey: "asset:imported" });
        expect(project.nodes[0].metadata.storageKey).toBe("asset:original");
    }
});
