import { useQuery } from "@tanstack/react-query";
import { RefreshCw, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Tooltip } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { formatAmount } from "@/lib/amounts";
import { cn } from "@/lib/utils";
import { assetId } from "@/services/api/assets";
import { quoteUsage } from "@/services/api/usage";
import { useAuthStore } from "@/stores/use-auth-store";
import { decodeChannelModel, findChannelModel, resolveModelParameters, useEffectiveConfig } from "@/stores/use-config-store";

export function PointsEstimate({ model, parameters, prompt = "", messages, requests = 1, className }: { model: string; parameters?: Record<string, unknown>; prompt?: string; messages?: unknown[]; requests?: number; className?: string }) {
    const { t, i18n } = useTranslation();
    const config = useEffectiveConfig();
    const owner = useAuthStore((state) => state.user?.id);
    const selected = findChannelModel(config, model)?.model;
    const channel = decodeChannelModel(model);
    const rateSets = [selected?.pricing.rates, ...(selected?.pricing.tiers?.map((tier) => tier.rates) || [])];
    const needsText = rateSets.some((rates) => rates && "characters" in rates);
    const hasPricing = rateSets.some((rates) => Object.keys(rates || {}).length > 0);
    const resolved = resolveModelParameters(config, model, parameters);
    for (const control of selected?.parameters || []) if (control.type === "asset" && typeof resolved[control.key] === "string") resolved[control.key] = assetId(resolved[control.key] as string) || resolved[control.key];
    const input = { channelId: channel?.channelId || "", modelId: selected?.id || "", parameters: resolved, prompt: needsText ? prompt.trim() : "", messages: needsText ? messages : undefined, requests };
    const quote = useQuery({ queryKey: ["points-quote", owner, selected?.version, selected?.pricing, input], queryFn: ({ signal }) => quoteUsage(input, signal), enabled: Boolean(owner && channel && selected && hasPricing && Number.isInteger(requests) && requests > 0) });
    const points = quote.data?.pointsMilli;
    const label = points != null ? t("points.estimated", { points: formatAmount(points, 3, i18n.resolvedLanguage || "zh-CN") }) : !selected ? t("points.selectModel") : quote.isFetching ? t("points.estimating") : quote.isError ? t("points.quoteFailed") : t("points.unknown");
    return <span className={cn("inline-flex shrink-0 items-center gap-1 text-xs tabular-nums text-muted-foreground", className)}><Tooltip title={<><span>{label}</span><span className="mt-1 block text-muted-foreground">{t("points.estimateHint")}</span></>}><span role="status" aria-label={label} className="inline-flex items-center gap-1"><Zap aria-hidden className="size-3.5" /><span>{points != null ? `≈${formatAmount(points, 3, i18n.resolvedLanguage || "zh-CN")}` : quote.isFetching ? "…" : t("usage.unknown")}</span></span></Tooltip>{quote.isError ? <Button variant="ghost" size="icon" className="size-5 [&_svg]:size-3" aria-label={t("workspace.retry")} onClick={() => void quote.refetch()}><RefreshCw /></Button> : null}</span>;
}
