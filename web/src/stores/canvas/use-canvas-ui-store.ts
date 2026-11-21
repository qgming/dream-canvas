import { create } from "zustand";

type CanvasUiStore = {
    activeProjectId: string | null;
    editingProjectId: string | null;
    deleteProjectId: string | null;
    startEditingProject: (id: string) => void;
    stopEditingProject: () => void;
    setDeleteProjectId: (id: string | null) => void;
};

export const useCanvasUiStore = create<CanvasUiStore>((set) => ({
    activeProjectId: null,
    editingProjectId: null,
    deleteProjectId: null,
    startEditingProject: (editingProjectId) => set({ editingProjectId }),
    stopEditingProject: () => set({ editingProjectId: null }),
    setDeleteProjectId: (deleteProjectId) => set({ deleteProjectId }),
}));
