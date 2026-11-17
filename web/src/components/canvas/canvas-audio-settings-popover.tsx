import { Settings2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Popover } from "@/components/ui/popover";
import { AudioSettingsPanel } from "@/components/audio-settings-panel";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { modelHasParameters, type AiConfig } from "@/stores/use-config-store";
import { audioFormatLabel, audioSpeedLabel, audioVoiceLabel } from "@/lib/audio-generation";
export type CanvasAudioSettingKey = "audioVoice" | "audioFormat" | "audioSpeed" | "audioInstructions";

type Props = {
    config: AiConfig; onConfigChange: (key: CanvasAudioSettingKey, value: string) => void;
    buttonClassName?: string; placement?: string; onOpenChange?: (open: boolean) => void;
};
export function CanvasAudioSettingsPopover({config, onConfigChange, onOpenChange, buttonClassName, placement = "topLeft" }: Props) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    if (modelHasParameters(config, config.model)) return null;
    return <Popover trigger="click" placement={placement} onOpenChange={onOpenChange} className="w-[356px]" content={<div><AudioSettingsPanel config={config} theme={theme} onConfigChange={onConfigChange} className="space-y-4" /></div>}>
        <Button size="sm" variant="ghost" className={buttonClassName || "max-w-[220px] justify-start"} icon={<Settings2 className="size-4" />}><span className="truncate">{audioVoiceLabel(config.audioVoice)} · {audioFormatLabel(config.audioFormat)} · {audioSpeedLabel(config.audioSpeed)}</span></Button>
    </Popover>;
}
