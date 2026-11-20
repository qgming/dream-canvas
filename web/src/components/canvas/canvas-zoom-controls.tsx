import { ChevronDown, Compass, Focus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/controls";
import { Popover, Tooltip } from "@/components/ui/popover";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";

type CanvasZoomControlsProps = {
    scale: number;
    onScaleChange: (scale: number) => void;
    onReset: () => void;
    isMiniMapOpen: boolean;
    onToggleMiniMap: () => void;
};

export function CanvasZoomControls({ scale, onScaleChange, onReset, isMiniMapOpen, onToggleMiniMap }: CanvasZoomControlsProps) {
    const [zoomOpen, setZoomOpen] = useState(false);
    const { t } = useTranslation();
    const colorTheme = useThemeStore((state) => state.theme);
    const theme = canvasThemes[colorTheme];
    const dockStyle = { background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.toolbar.item, boxShadow: "var(--shadow-lg)" };
    const activeStyle = { background: theme.toolbar.activeBg, color: theme.toolbar.activeText };
    const zoomPercent = Math.round(scale * 100);

    return (
        <div className="absolute bottom-5 left-4 z-50 max-w-[calc(100%-96px)]" data-ui-overlay data-canvas-no-zoom data-canvas-shortcuts-ignore onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
            <div className="flex items-center gap-1 rounded-xl border p-1 shadow-lg backdrop-blur" style={dockStyle}>
                <Tooltip title={isMiniMapOpen ? t("canvas.miniMapClose") : t("canvas.miniMapOpen")}>
                    <Button
                        variant="ghost"
                        size="icon"
                        style={isMiniMapOpen ? activeStyle : { color: theme.toolbar.item }}
                        icon={<Compass className="size-4" />}
                        onClick={onToggleMiniMap}
                        aria-pressed={isMiniMapOpen}
                        aria-label={isMiniMapOpen ? t("canvas.miniMapClose") : t("canvas.miniMapOpen")}
                    />
                </Tooltip>
                <Tooltip title={t("canvas.resetView")}>
                    <Button variant="ghost" size="icon" style={{ color: theme.toolbar.item }} icon={<Focus className="size-4" />} onClick={onReset} aria-label={t("canvas.resetView")} />
                </Tooltip>
                <Popover
                    trigger="click"
                    placement="topLeft"
                    open={zoomOpen}
                    onOpenChange={setZoomOpen}
                    className="w-96 p-1"
                    content={
                        <div role="group" aria-label={t("canvas.zoom")} className="flex min-w-0 items-center gap-2">
                            <div className="flex shrink-0 items-center gap-1">
                                {[50, 100, 200].map((percent) => (
                                    <Button
                                        key={percent}
                                        variant="ghost"
                                        className="h-8 px-2 text-xs tabular-nums aria-pressed:bg-accent aria-pressed:text-accent-foreground"
                                        aria-label={t("canvas.zoomTo", { percent })}
                                        title={t("canvas.zoomTo", { percent })}
                                        aria-pressed={zoomPercent === percent}
                                        onClick={() => onScaleChange(percent / 100)}
                                    >
                                        {percent}%
                                    </Button>
                                ))}
                            </div>
                            <Slider
                                name="canvas-zoom"
                                min={5}
                                max={500}
                                step={1}
                                value={zoomPercent}
                                onChange={(percent) => onScaleChange(percent / 100)}
                                aria-label={t("canvas.zoom")}
                                className="min-w-16 flex-1"
                            />
                        </div>
                    }
                >
                    <Button variant="ghost" className="h-8 w-16 gap-1 px-1 text-xs tabular-nums" style={zoomOpen ? activeStyle : { color: theme.toolbar.item }} aria-label={t("canvas.zoomValue", { percent: zoomPercent })} title={t("canvas.zoom")}>
                        {zoomPercent}%<ChevronDown className="size-3.5" />
                    </Button>
                </Popover>
            </div>
        </div>
    );
}
