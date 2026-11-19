import { useEffect } from "react";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useGenerationProgressStore } from "@/stores/use-generation-progress-store";
import { captureSession } from "@/services/api/client";
import { listGenerations } from "@/services/api/tasks";

// Task execution belongs to the server; subscriptions outlive individual canvas routes.
export function useCanvasTasks(owner?: string) {
    const hydrated = useCanvasStore((state) => state.hydrated);
    useEffect(() => {
        if (!owner || !hydrated) return;
        const assertSession = captureSession();
        let disposed = false, refreshing = false, pending = false;
        const refresh = async () => {
            if (disposed) return;
            if (refreshing) { pending = true; return; }
            refreshing = true;
            try {
                const tasks = await listGenerations(); assertSession(); if (disposed) return;
                const ids = new Set(tasks.map((task) => task.id));
                for (const id of Object.keys(useGenerationProgressStore.getState().tasks)) if (!ids.has(id)) useGenerationProgressStore.getState().remove(id);
                const projects = new Set<string>();
                for (const task of tasks) {
                    if (!task.projectId || !task.nodeId) continue;
                    useGenerationProgressStore.getState().receive(task);
                    if (task.appliedVersion > (useCanvasStore.getState().bases[task.projectId]?.version || 0) && useCanvasStore.getState().openProject(task.projectId)) projects.add(task.projectId);
                }
                useGenerationProgressStore.setState({ loaded: true });
                await Promise.all([...projects].map((id) => useCanvasStore.getState().syncProject(id))); assertSession();
            } catch (error) {
                try { assertSession(); } catch { return; }
                if (!disposed) useCanvasStore.setState({ error: error instanceof Error ? error.message : String(error) });
            } finally { refreshing = false; if (pending) { pending = false; void refresh(); } }
        };
        const changed = (event: Event) => { const topic = (event as CustomEvent<string>).detail; if (!topic || topic === "all" || topic === "tasks") void refresh(); };
        void refresh();
        window.addEventListener("server-changed", changed);
        window.addEventListener("focus", refresh);
        window.addEventListener("online", refresh);
        return () => { disposed = true; window.removeEventListener("server-changed", changed); window.removeEventListener("focus", refresh); window.removeEventListener("online", refresh); useGenerationProgressStore.setState({ tasks: {}, loaded: false }); };
    }, [owner, hydrated]);
}
