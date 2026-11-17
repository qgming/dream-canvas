import { Settings2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Popover } from "@/components/ui/popover";
import { reasoningEffortLabel, TextSettingsPanel } from "@/components/text-settings-panel";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { AiConfig, ReasoningEffort } from "@/stores/use-config-store";
import { NumberInput } from "@/components/ui/input";

type Props = {
    config: AiConfig; onConfigChange: (key: "reasoningEffort", value: ReasoningEffort) => void;
    buttonClassName?: string; placement?: string; onOpenChange?: (open: boolean) => void;
    count?: number; onCountChange?: (count: number) => void;
};
export function CanvasTextSettingsPopover({count, onCountChange, config, onConfigChange, onOpenChange, buttonClassName, placement = "topLeft" }: Props) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    return <Popover trigger="click" placement={placement} onOpenChange={onOpenChange} className="w-[356px]" content={<div><TextSettingsPanel config={config} theme={theme} onConfigChange={onConfigChange} className="space-y-4" />{onCountChange ? <label className="mt-4 block space-y-2 text-sm"><span>{t("settingsPanels.text.count")}</span><NumberInput min={1} max={15} precision={0} value={count} onChange={(value) => onCountChange(value || 1)} /></label> : null}</div>}>
        <Button size="sm" variant="ghost" className={buttonClassName || "max-w-[220px] justify-start"} icon={<Settings2 className="size-4" />}><span className="truncate">{t("canvas.controls.reasoning")} · {reasoningEffortLabel(config.reasoningEffort)}{onCountChange ? ` · ${t("canvas.controls.generations", { count })}` : ""}</span></Button>
    </Popover>;
}
