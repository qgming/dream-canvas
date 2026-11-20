import { z } from "zod";

import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import type { CanvasExportFile } from "@/types/canvas-export";

const id = z.string().min(1);
const finite = z.number().finite();
const status = z.enum(["idle", "success", "loading", "error"]);
const timestamp = z.string().datetime({ offset: true });
const text = z.object({ id, status, content: z.string(), errorDetails: z.string().optional() }).passthrough();
const image = text.extend({ storageKey: z.string().optional(), naturalWidth: finite.nonnegative(), naturalHeight: finite.nonnegative(), bytes: finite.int().nonnegative(), mimeType: z.string(), durationMs: finite.nonnegative().optional() });
const metadata = z.object({
    content: z.string().optional(), composerContent: z.string().optional(), prompt: z.string().optional(),
    status: status.optional(), errorDetails: z.string().optional(), fontSize: finite.optional(),
    generationMode: z.enum(["text", "image", "video", "audio"]).optional(), generationType: z.enum(["generation", "edit"]).optional(),
    model: z.string().optional(), modelParameters: z.record(z.record(z.unknown())).optional(),
    reasoningEffort: z.enum(["auto", "low", "medium", "high", "xhigh"]).optional(),
    count: finite.optional(), textCount: finite.optional(), texts: z.array(text).optional(), primaryTextId: z.string().optional(),
    references: z.array(z.string()).optional(), referenceOrder: z.array(id).optional(), naturalWidth: finite.optional(), naturalHeight: finite.optional(), freeResize: z.boolean().optional(),
    images: z.array(image).optional(), primaryImageId: z.string().optional(), storageKey: z.string().optional(), mimeType: z.string().optional(),
    mediaResults: z.array(image).optional(), primaryMediaId: z.string().optional(),
    bytes: finite.optional(), durationMs: finite.optional(), videoTaskId: z.string().optional(), videoTaskProvider: z.literal("server").optional(),
    groupId: z.string().optional(), interactive: z.boolean().optional(),
}).passthrough();
const node = z.object({ id, type: id, identity: z.object({ type: id, number: finite.int().safe().positive(), copy: finite.int().safe().positive() }).optional(), name: z.string().min(1).optional(), title: z.string(), position: z.object({ x: finite, y: finite }).passthrough(), width: finite.positive(), height: finite.positive(), metadata: metadata.optional() }).passthrough();
const connection = z.object({ id, fromNodeId: id, toNodeId: id }).passthrough();
const reference = z.object({ id, type: id, title: z.string(), dataUrl: z.string().optional(), storageKey: z.string().optional(), text: z.string().optional() }).passthrough();
const message = z.object({ id, role: z.enum(["user", "assistant", "system", "tool", "error"]), text: z.string(), title: z.string().optional(), meta: z.string().optional(), detail: z.unknown().optional(), references: z.array(reference).optional() }).passthrough();
const session = z.object({ id, title: z.string(), messages: z.array(message), createdAt: timestamp, updatedAt: timestamp }).passthrough();

// Validate current-format records without stripping plugin fields or repairing stored data.
export const canvasProjectSchema = z.object({
    id, title: z.string(), version: finite.int().safe().positive(), createdAt: timestamp, updatedAt: timestamp,
    nodes: z.array(node), connections: z.array(connection), chatSessions: z.array(session), activeChatId: id.nullable(),
    backgroundMode: z.enum(["dots", "lines", "blank"]), showImageInfo: z.boolean(),
    viewport: z.object({ x: finite, y: finite, k: finite.positive() }).passthrough(),
}).passthrough().superRefine((project, context) => {
    const nodeIds = new Set(project.nodes.map((item) => item.id));
    if (nodeIds.size !== project.nodes.length || new Set(project.connections.map((item) => item.id)).size !== project.connections.length) context.addIssue({ code: "custom", message: "节点或连线编号重复" });
    if (project.connections.some((item) => !nodeIds.has(item.fromNodeId) || !nodeIds.has(item.toNodeId))) context.addIssue({ code: "custom", message: "连线引用的节点不存在" });
    if (new Set(project.chatSessions.map((item) => item.id)).size !== project.chatSessions.length || (project.activeChatId !== null && !project.chatSessions.some((item) => item.id === project.activeChatId))) context.addIssue({ code: "custom", message: "画布对话引用不正确" });
}) satisfies z.ZodType<CanvasProject>;

export const canvasExportSchema = z.object({
    app: z.literal("infinite-canvas"), version: z.literal(3), exportedAt: timestamp,
    projects: z.array(z.object({ project: canvasProjectSchema, files: z.array(z.object({ storageKey: z.string().startsWith("asset:"), path: id, mimeType: z.string(), bytes: finite.int().nonnegative() }).passthrough()) }).passthrough()),
}).passthrough() satisfies z.ZodType<CanvasExportFile>;
