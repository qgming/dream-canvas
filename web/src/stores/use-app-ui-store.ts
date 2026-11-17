import { create } from "zustand";
import { persist } from "zustand/middleware";

export const useAppUiStore = create<{ sidebarCollapsed: boolean; toggleSidebar: () => void; workbenchHistoryOpen: boolean; toggleWorkbenchHistory: () => void }>()(
    persist((set) => ({
        sidebarCollapsed: false,
        toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
        workbenchHistoryOpen: true,
        toggleWorkbenchHistory: () => set((state) => ({ workbenchHistoryOpen: !state.workbenchHistoryOpen })),
    }), { name: "dream-canvas:app-ui" }),
);
