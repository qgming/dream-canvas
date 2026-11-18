import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AiConfig } from "@/stores/use-config-store";

export function ImageSettingsPanel({ config, onConfigChange, showTitle = true, className = "space-y-3", maxCount = 15 }: { config: AiConfig; onConfigChange: (key: "count", value: string) => void; showTitle?: boolean; className?: string; maxCount?: number }) {
    const { t } = useTranslation();
    const count = Math.max(1, Math.min(maxCount, Math.floor(Math.abs(Number(config.count)) || 1)));
    return <div className={className} onMouseDown={(event) => event.stopPropagation()}>
        {showTitle ? <div className="text-base font-semibold">{t("modelScripts.requestCount")}</div> : null}
        <label className="block space-y-2 text-sm">
            <span>{t("modelScripts.requestCount")}</span>
            <Input aria-label={t("modelScripts.requestCount")} type="number" min={1} max={maxCount} step={1} value={config.count} onChange={(event) => onConfigChange("count", event.target.value)} />
        </label>
        <div className="grid grid-cols-4 gap-2">{Array.from({ length: Math.min(10, maxCount) }, (_, index) => index + 1).map((value) => <Button key={value} size="sm" variant="ghost" aria-pressed={count === value} className="aria-pressed:bg-accent" onClick={() => onConfigChange("count", String(value))}>{t("modelScripts.requests", { count: value })}</Button>)}</div>
    </div>;
}
