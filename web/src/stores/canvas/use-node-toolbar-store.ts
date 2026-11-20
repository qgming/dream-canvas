import { create } from "zustand";
import { persist } from "zustand/middleware";

export type NodeToolbarConfig = { hiddenIds: string[]; showLabels: boolean };

type NodeToolbarStore = {
    configs: Record<string, NodeToolbarConfig | undefined>;
    saveConfig: (nodeType: string, config: NodeToolbarConfig) => void;
};

export const useNodeToolbarStore = create<NodeToolbarStore>()(
    persist((set) => ({
        configs: {},
        saveConfig: (nodeType, config) => set((state) => ({ configs: { ...state.configs, [nodeType]: config } })),
    }), { name: "dream-canvas:node-toolbars" }),
);
