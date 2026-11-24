import { useAgentStore } from "@/stores/use-agent-store";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";

export function useAgentReferenceNodes(projectId: string, enabled: boolean) {
    const live = useAgentStore((state) => {
        const snapshot = state.canvasContext?.snapshot;
        return enabled && snapshot?.projectId === projectId ? snapshot : undefined;
    });
    const saved = useCanvasStore((state) => enabled && projectId && !live ? state.bases[projectId]?.nodes : undefined);
    return { nodes: live?.nodes ?? saved, selectedNodeIds: live?.selectedNodeIds };
}
