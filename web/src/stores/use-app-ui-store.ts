import { create } from "zustand";
import { persist } from "zustand/middleware";

export const useAppUiStore = create<{ sidebarCollapsed: boolean; toggleSidebar: () => void }>()(
    persist((set) => ({
        sidebarCollapsed: false,
        toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
    }), { name: "dream-canvas:app-ui" }),
);
