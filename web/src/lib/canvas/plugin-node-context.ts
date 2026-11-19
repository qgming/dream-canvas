import { createPluginStorage, emitCanvasEvent, onCanvasEvent } from "@/lib/canvas/canvas-event-bus";
import { getNodePluginId } from "@/lib/canvas/node-registry";
import type { CanvasTheme } from "@/lib/canvas-theme";
import type { CanvasNodeData } from "@/types/canvas";
import type { CanvasNodeContext, CanvasPluginHost } from "@/types/canvas-plugin";

// Assemble host capabilities, node data, theme, and scale into the context injected into plugin nodes.
export function buildNodeContext(host: CanvasPluginHost, node: CanvasNodeData, theme: CanvasTheme, scale: number, isSelected = false): CanvasNodeContext {
    const storage = createPluginStorage(getNodePluginId(node.type));
    return {
        node,
        theme,
        scale,
        isSelected,
        updateMetadata: (patch) => host.updateMetadata(node.id, patch),
        updateNode: (patch) => host.updateNode(node.id, patch),
        getNode: (id) => host.getNode(id),
        getNodes: () => host.getNodes(),
        getConnections: () => host.getConnections(),
        getUpstream: () => host.getUpstream(node.id),
        getDownstream: () => host.getDownstream(node.id),
        applyOps: (ops) => host.applyOps(ops),
        emit: (event, payload) => emitCanvasEvent(event, payload),
        on: (event, handler) => onCanvasEvent(event, handler),
        ai: {
            ...host.ai,
            generateImage: (prompt, options) => host.ai.generateImage(prompt, { ...options, nodeId: node.id }),
            generateVideo: (prompt, options) => host.ai.generateVideo(prompt, { ...options, nodeId: node.id }),
            generateText: (prompt, options) => host.ai.generateText(prompt, { ...options, nodeId: node.id }),
            stopGeneration: () => host.ai.stopGeneration(node.id),
        },
        openPanel: () => host.openPanel(node.id),
        closePanel: () => host.closePanel(),
        storage,
    };
}
