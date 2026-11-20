import { create } from "zustand";

type CanvasUiStore = {
    activeProjectId: string | null;
    editingProjectId: string | null;
    deleteProjectIds: string[];
    startEditingProject: (id: string) => void;
    stopEditingProject: () => void;
    setDeleteProjectIds: (ids: string[]) => void;
};

export const useCanvasUiStore = create<CanvasUiStore>((set) => ({
    activeProjectId: null,
    editingProjectId: null,
    deleteProjectIds: [],
    startEditingProject: (editingProjectId) => set({ editingProjectId }),
    stopEditingProject: () => set({ editingProjectId: null }),
    setDeleteProjectIds: (deleteProjectIds) => set({ deleteProjectIds }),
}));
