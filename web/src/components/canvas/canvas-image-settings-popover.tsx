import { Settings2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Popover } from "@/components/ui/popover";
import { ImageSettingsPanel } from "@/components/image-settings-panel";
import type { AiConfig } from "@/stores/use-config-store";

type Props = {
    config: AiConfig; onConfigChange: (key: "count", value: string) => void;
    buttonClassName?: string; placement?: string; onOpenChange?: (open: boolean) => void;
};
export function CanvasImageSettingsPopover({config, onConfigChange, onOpenChange, buttonClassName, placement = "topLeft" }: Props) {
    const { t } = useTranslation();
    return <Popover trigger="click" placement={placement} onOpenChange={onOpenChange} className="w-[356px]" content={<ImageSettingsPanel config={config} onConfigChange={onConfigChange} showTitle={false} />}>
        <Button size="sm" variant="ghost" className={buttonClassName || "max-w-[220px] justify-start"} icon={<Settings2 className="size-4" />}><span className="truncate">{t("modelScripts.requests", { count: Math.max(1, Math.min(15, Number(config.count) || 1)) })}</span></Button>
    </Popover>;
}
