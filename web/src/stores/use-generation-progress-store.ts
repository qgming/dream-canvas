import { create } from "zustand";
import type { GenerationTask } from "@/services/api/tasks";

// Transient subscription state; task history remains authoritative on the server.
export const useGenerationProgressStore = create<{ tasks: Record<string, GenerationTask>; loaded: boolean; receive: (task: GenerationTask) => void; remove: (id: string) => void }>((set) => ({
    tasks: {},
    loaded: false,
    receive: (task) => { if (task.projectId && task.nodeId) set((state) => state.tasks[task.id] && Date.parse(state.tasks[task.id].updatedAt) > Date.parse(task.updatedAt) ? state : { tasks: { ...state.tasks, [task.id]: task } }); },
    remove: (id) => set((state) => { if (!state.tasks[id]) return state; const tasks = { ...state.tasks }; delete tasks[id]; return { tasks }; }),
}));
