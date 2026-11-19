import { applyPatch, compare, type Operation } from "fast-json-patch";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";

// Stable IDs keep concurrent node/slot additions independent of their array positions.
type Value = null | boolean | number | string | Value[] | { [key: string]: Value };
const rows = "$canvasRows";
const order = "$canvasOrder";
function normalize(value: Value): Value {
    if (Array.isArray(value)) {
        if (value.every((item) => item && !Array.isArray(item) && typeof item === "object" && typeof item.id === "string")) {
            return { [rows]: Object.fromEntries(value.map((item) => [(item as { id: string }).id, normalize(item)])), [order]: JSON.stringify(value.map((item) => (item as { id: string }).id)) };
        }
        return value.map(normalize);
    }
    return value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalize(item)])) : value;
}
function denormalize(value: Value): Value {
    if (Array.isArray(value)) return value.map(denormalize);
    if (!value || typeof value !== "object") return value;
    if (value[rows] && typeof value[order] === "string") {
        const items = value[rows] as Record<string, Value>;
        const ids = [...new Set<string>([...JSON.parse(value[order] as string), ...Object.keys(items).sort()])];
        return ids.filter((id) => Object.prototype.hasOwnProperty.call(items, id)).map((id) => denormalize(items[id]));
    }
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, denormalize(item)]));
}
export function projectContent(project: CanvasProject) {
    const { id: _id, version: _version, createdAt: _created, updatedAt: _updated, ...content } = project;
    return normalize(JSON.parse(JSON.stringify(content)) as Value);
}
export function projectChanges(before: CanvasProject, after: CanvasProject): Operation[] {
    return compare(projectContent(before) as object, projectContent(after) as object);
}
export function applyProjectChanges(project: CanvasProject, changes: Operation[]): CanvasProject {
    const content = denormalize(applyPatch(projectContent(project), structuredClone(changes), true, false).newDocument);
    const next = { ...project, ...(content as object) } as CanvasProject;
    const ids = new Set(next.nodes.map((node) => node.id));
    next.connections = next.connections.filter((connection) => ids.has(connection.fromNodeId) && ids.has(connection.toNodeId));
    return next;
}

export function rebaseProject(base: CanvasProject, local: CanvasProject, remote: CanvasProject): CanvasProject {
    // A streamed/loading result belongs to its task. A final server result must not
    // be replaced by an older local progress snapshot while unrelated edits rebase.
    const next = { ...local, nodes: local.nodes.map((node) => {
        const current = remote.nodes.find((item) => item.id === node.id), original = base.nodes.find((item) => item.id === node.id);
        if (!current || !original || !node.metadata) return node;
        const metadata = { ...node.metadata }, incoming = current.metadata || {}, before = original.metadata || {};
        if (before.status !== "loading") return node;
        let completed = false;
        for (const key of ["images", "texts"] as const) {
            const slots = metadata[key];
            if (!slots) continue;
            const merged = slots.map((slot) => {
                const saved = incoming[key]?.find((item) => item.id === slot.id), previous = before[key]?.find((item) => item.id === slot.id);
                if (slot.status !== "loading" || !saved || saved.status === "loading" || saved.status === previous?.status && saved.content === previous?.content) return slot;
                completed = true; return saved;
            });
            Object.assign(metadata, { [key]: merged });
        }
        if (completed || metadata.status === "loading" && incoming.status !== "loading" && (incoming.content !== before.content || incoming.storageKey !== before.storageKey)) {
            for (const key of ["content", "storageKey", "status", "errorDetails", "naturalWidth", "naturalHeight", "bytes", "mimeType", "durationMs", "primaryImageId", "primaryTextId"] as const) Object.assign(metadata, { [key]: incoming[key] });
        }
        return { ...node, metadata };
    }) };
    return applyProjectChanges(remote, projectChanges(base, next));
}
