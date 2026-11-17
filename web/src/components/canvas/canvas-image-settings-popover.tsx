import { Settings2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Popover } from "@/components/ui/popover";
import { ImageSettingsPanel, imageQualityLabel, imageSizeLabel } from "@/components/image-settings-panel";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { AiConfig } from "@/stores/use-config-store";

type Props = {
    config: AiConfig; onConfigChange: (key: keyof AiConfig, value: string) => void;
    buttonClassName?: string; placement?: string; onOpenChange?: (open: boolean) => void;
};
export function CanvasImageSettingsPopover({config, onConfigChange, onOpenChange, buttonClassName, placement = "topLeft" }: Props) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    return <Popover trigger="click" placement={placement} onOpenChange={onOpenChange} className="w-[356px]" content={<div><ImageSettingsPanel config={config} theme={theme} onConfigChange={onConfigChange} className="space-y-4" /></div>}>
        <Button size="sm" variant="ghost" className={buttonClassName || "max-w-[220px] justify-start"} icon={<Settings2 className="size-4" />}><span className="truncate">{imageQualityLabel(config.quality || "auto")} · {imageSizeLabel(config.size || "auto")} · {t("canvas.controls.images", { count: Math.max(1, Math.min(15, Number(config.count) || 1)) })}</span></Button>
    </Popover>;
}
