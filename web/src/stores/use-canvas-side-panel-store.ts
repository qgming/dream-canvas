import { create } from "zustand";
import { SIDE_PANEL_MOTION_MS } from "@/lib/side-panel-motion";

const OPEN_KEY = "canvas-side-panel-open";
const NODE_VIEW_KEY = "canvas-side-panel-node-view";

export type CanvasNodeViewMode = "list" | "grid";

function initialOpen() {
    if (typeof window === "undefined") return true;
    return localStorage.getItem(OPEN_KEY) !== "0";
}

function initialNodeView(): CanvasNodeViewMode {
    if (typeof window === "undefined") return "list";
    return localStorage.getItem(NODE_VIEW_KEY) === "grid" ? "grid" : "list";
}

type CanvasSidePanelStore = {
    panelOpen: boolean;
    panelMounted: boolean;
    panelClosing: boolean;
    compactOpen: boolean;
    nodeViewMode: CanvasNodeViewMode;
    setNodeViewMode: (mode: CanvasNodeViewMode) => void;
    openPanel: () => void;
    closePanel: () => void;
    togglePanel: () => void;
};

export const useCanvasSidePanelStore = create<CanvasSidePanelStore>((set, get) => ({
    panelOpen: initialOpen(),
    panelMounted: initialOpen(),
    panelClosing: false,
    compactOpen: false,
    nodeViewMode: initialNodeView(),
    setNodeViewMode: (mode) => {
        if (typeof window !== "undefined") localStorage.setItem(NODE_VIEW_KEY, mode);
        set({ nodeViewMode: mode });
    },
    openPanel: () => {
        if (typeof window !== "undefined") localStorage.setItem(OPEN_KEY, "1");
        set({ panelOpen: true, panelMounted: true, panelClosing: false });
    },
    closePanel: () => {
        if (!get().panelMounted || get().panelClosing) return;
        if (typeof window !== "undefined") localStorage.setItem(OPEN_KEY, "0");
        set({ panelOpen: false, panelClosing: true });
        setTimeout(() => {
            if (get().panelClosing) set({ panelMounted: false, panelClosing: false });
        }, SIDE_PANEL_MOTION_MS);
    },
    togglePanel: () => (get().panelOpen ? get().closePanel() : get().openPanel()),
}));
