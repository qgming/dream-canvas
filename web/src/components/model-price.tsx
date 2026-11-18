import { Zap } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Tooltip } from "@/components/ui/popover";
import { inputLabel } from "@/lib/model-inputs";
import type { ParameterControl, PointsPricing } from "@/services/api/channels";

export function ModelPrice({ pricing, parameters = [] }: { pricing: PointsPricing; parameters?: ParameterControl[] }) {
    const { t } = useTranslation();
    const rates = Object.entries(pricing.rates || {});
    const label = (unit: string, rate: { per: string; points?: string }) => rate.points == null ? t("points.unknown") : t("points.unit", { points: rate.points, per: rate.per === "1" ? "" : rate.per, unit: t(`points.units.${unit}`, { defaultValue: unit }) });
    const summary = pricing.tiers?.length ? t("points.tiered") : rates.length === 1 ? label(rates[0][0], rates[0][1]) : rates.length ? t("points.tiered") : t("points.unknown");
    return <Tooltip title={<div className="space-y-2"><div>{rates.length ? rates.map(([unit, rate]) => <div key={unit}>{label(unit, rate)}</div>) : t("points.unknown")}</div>{pricing.tiers?.map((tier, index) => <div key={tier.id || index}><div className="font-medium">{Object.entries(tier.conditions).map(([key, value]) => `${parameters.find((control) => control.key === key) ? inputLabel(parameters.find((control) => control.key === key)!) : key} = ${typeof value === "boolean" ? t(value ? "workspace.enabled" : "workspace.disabled") : value}`).join(` ${t("modelScripts.and")} `)}</div>{Object.keys(tier.rates).length ? Object.entries(tier.rates).map(([unit, rate]) => <div key={unit}>{label(unit, rate)}</div>) : t("points.unknown")}</div>)}</div>}><span className="inline-flex shrink-0 items-center gap-1 text-xs font-normal text-muted-foreground"><Zap aria-hidden className="size-3" /><span>{summary}</span></span></Tooltip>;
}
