import { create } from "zustand";
import { useShallow } from "zustand/shallow";
import i18n from "@/i18n";
import type { GenerationTask } from "@/services/api/tasks";

type GenerationRequest = { projectId: string; nodeId: string; signal: AbortSignal; taskIds: Set<string> };
type GenerationProgressState = {
    tasks: Record<string, GenerationTask>;
    requests: GenerationRequest[];
    loaded: boolean;
    receive: (task: GenerationTask, signal?: AbortSignal) => void;
    remove: (id: string) => void;
    startRequest: (projectId: string, nodeId: string, signal: AbortSignal, taskId?: string) => void;
    finishRequest: (projectId: string, nodeId: string, signal: AbortSignal) => void;
};

// Transient subscription state; task history remains authoritative on the server.
export const useGenerationProgressStore = create<GenerationProgressState>((set) => ({
    tasks: {},
    requests: [],
    loaded: false,
    receive: (task, signal) => { if (task.projectId && task.nodeId) set((state) => {
        const current = state.tasks[task.id];
        const tasks = current && Date.parse(current.updatedAt) > Date.parse(task.updatedAt) ? state.tasks : { ...state.tasks, [task.id]: task };
        const requests = signal ? state.requests.map((request) => request.projectId === task.projectId && request.nodeId === task.nodeId && request.signal === signal && !request.taskIds.has(task.id) ? { ...request, taskIds: new Set([...request.taskIds, task.id]) } : request) : state.requests;
        return { tasks, requests };
    }); },
    remove: (id) => set((state) => { if (!state.tasks[id]) return state; const tasks = { ...state.tasks }; delete tasks[id]; return { tasks }; }),
    startRequest: (projectId, nodeId, signal, taskId) => set((state) => {
        if (state.requests.some((request) => request.projectId === projectId && request.nodeId === nodeId && request.signal === signal)) return state;
        return { requests: [...state.requests.filter((request) => request.projectId !== projectId || request.nodeId !== nodeId), { projectId, nodeId, signal, taskIds: new Set(taskId ? [taskId] : []) }] };
    }),
    finishRequest: (projectId, nodeId, signal) => set((state) => {
        const requests = state.requests.filter((request) => request.projectId !== projectId || request.nodeId !== nodeId || request.signal !== signal);
        return requests.length === state.requests.length ? state : { requests };
    }),
}));

export function canvasGenerationTask(state: GenerationProgressState, projectId?: string, nodeId?: string, slotId?: string) {
    const request = state.requests.find((item) => item.projectId === projectId && item.nodeId === nodeId);
    return Object.values(state.tasks).filter((task) => task.projectId === projectId && task.nodeId === nodeId && (!slotId || !task.input.resultSlotId || task.input.resultSlotId === slotId) && (!request || request.taskIds.has(task.id))).sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
}

export function canvasGenerationProgress(state: GenerationProgressState, projectId?: string, nodeId?: string, slotId?: string) {
    const task = canvasGenerationTask(state, projectId, nodeId, slotId);
    if (task?.status === "succeeded" && !task.applied) return { ...task, status: "confirmation_required", error: task.applyError || i18n.t("workspace.canvasResultUnapplied") };
    return task || (state.loaded && !state.requests.some((request) => request.projectId === projectId && request.nodeId === nodeId) ? { status: "interrupted", error: i18n.t("canvas.generation.interrupted") } : undefined);
}

export function useCanvasGenerationProgress(projectId?: string, nodeId?: string, slotId?: string) {
    return useGenerationProgressStore(useShallow((state) => canvasGenerationProgress(state, projectId, nodeId, slotId)));
}
