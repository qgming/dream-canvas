import { useMediaQuery } from "./use-media-query";
import { useCanvasSidePanelStore } from "@/stores/use-canvas-side-panel-store";

export function useCanvasPanelDisplay() {
    const compact = useMediaQuery("(max-width: 959px)");
    const panelOpen = useCanvasSidePanelStore((state) => state.panelOpen);
    const panelMounted = useCanvasSidePanelStore((state) => state.panelMounted);
    const panelClosing = useCanvasSidePanelStore((state) => state.panelClosing);
    const compactOpen = useCanvasSidePanelStore((state) => state.compactOpen);
    const open = compact ? compactOpen : panelOpen;
    const toggle = () => compact ? useCanvasSidePanelStore.setState({ compactOpen: !compactOpen }) : useCanvasSidePanelStore.getState().togglePanel();
    return { compact, open, mounted: compact ? compactOpen : panelMounted, closing: !compact && panelClosing, toggle };
}
