import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, FilterChip, Notice } from "@/components/ui/display";
import { DataTable } from "@/components/ui/data-table";
import { Choice } from "@/components/ui/choice";
import { Input } from "@/components/ui/input";
import { useAuthStore } from "@/stores/use-auth-store";
import { useConfigStore } from "@/stores/use-config-store";
import { getUsage } from "@/services/api/runtime";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";

type RangeKey = "today" | "last24h" | "days7" | "days30" | "custom";
type FilterKey = "projectId" | "channelId" | "modelId" | "capability";
type UsageModel = Awaited<ReturnType<typeof getUsage>>["summary"]["byModel"][number];

const ranges: RangeKey[] = ["today", "last24h", "days7", "days30", "custom"];
const capabilities = ["text", "image", "video", "audio"];

export function UsagePanel() {
    const { t, i18n } = useTranslation();
    const admin = useAuthStore((state) => state.user?.role === "admin");
    const channels = useConfigStore((state) => state.config.channels);
    const projects = useCanvasStore((state) => state.projects);
    const locale = i18n.resolvedLanguage || "zh-CN";
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const [range, setRange] = useState<RangeKey>("today");
    const [anchor, setAnchor] = useState(() => new Date());
    const [customFrom, setCustomFrom] = useState(() => datetimeLocal(startOfToday(new Date(), timeZone)));
    const [customTo, setCustomTo] = useState(() => datetimeLocal(new Date()));
    const [filters, setFilters] = useState<Record<FilterKey, string>>({ projectId: "", channelId: "", modelId: "", capability: "" });
    const [scope, setScope] = useState("mine");
    const site = admin && scope === "site";

    const timeWindow = useMemo(() => rangeWindow(range, anchor, customFrom, customTo, timeZone), [range, anchor, customFrom, customTo, timeZone]);
    const queryFilters = { ...filters, ...timeWindow, timeZone };
    const customIncomplete = range === "custom" && (!timeWindow.from || !timeWindow.to);
    const customInvalid = range === "custom" && !customIncomplete && new Date(timeWindow.from).getTime() >= new Date(timeWindow.to).getTime();
    const rangeInvalid = customIncomplete || customInvalid;
    const query = useQuery({
        queryKey: ["usage", site, queryFilters],
        queryFn: () => getUsage(site, queryFilters),
        enabled: !rangeInvalid,
    });

    useEffect(() => {
        const refresh = (event: Event) => {
            const topic = (event as CustomEvent<string>).detail;
            if (!topic || topic === "all") {
                if (range === "custom") {
                    if (!rangeInvalid) void query.refetch();
                } else {
                    setAnchor(new Date());
                }
            }
        };
        window.addEventListener("server-changed", refresh);
        return () => window.removeEventListener("server-changed", refresh);
    }, [query.refetch, range, rangeInvalid]);

    const change = (key: FilterKey, value: string) => setFilters((current) => ({ ...current, [key]: value || "", ...(key === "channelId" ? { modelId: "" } : {}) }));
    const chooseRange = (next: RangeKey) => {
        const now = new Date();
        setAnchor(now);
        setRange(next);
        if (next === "custom") setCustomTo(datetimeLocal(now));
    };
    const refresh = () => {
        if (rangeInvalid) return;
        setAnchor(new Date());
        if (range === "custom") void query.refetch();
    };
    const modelLabel = (channelId: string, modelId: string) => {
        const channel = channels.find((item) => item.id === channelId);
        return `${channel?.name || channelId} / ${channel?.models.find((item) => item.id === modelId)?.label || modelId}`;
    };
    const data = rangeInvalid ? undefined : query.data;

    return <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1" aria-label={t("usage.rangeLabel")}>
                {ranges.map((value) => <FilterChip key={value} checked={range === value} onChange={() => chooseRange(value)}>{t(`usage.ranges.${value}`)}</FilterChip>)}
            </div>
            <div className="flex items-center gap-2">
                {admin ? <Choice className="w-32" aria-label={t("usage.scope")} value={scope} onChange={setScope} options={[{ value: "mine", label: t("usage.mine") }, { value: "site", label: t("usage.site") }]} /> : null}
                <Button variant="outline" icon={<RefreshCw />} loading={!rangeInvalid && query.isFetching} disabled={rangeInvalid} onClick={refresh}>{t("workspace.refresh")}</Button>
            </div>
        </div>
        {range === "custom" ? <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-xs text-muted-foreground"><span>{t("usage.from")}</span><Input type="datetime-local" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} /></label>
            <label className="space-y-1 text-xs text-muted-foreground"><span>{t("usage.to")}</span><Input type="datetime-local" value={customTo} onChange={(event) => setCustomTo(event.target.value)} /></label>
        </div> : null}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Choice clearable aria-label={t("workspace.project")} placeholder={t("workspace.project")} value={filters.projectId || undefined} options={projects.map((project) => ({ value: project.id, label: project.title }))} onChange={(value) => change("projectId", value)} />
            <Choice clearable aria-label={t("workspace.channel")} placeholder={t("workspace.channel")} value={filters.channelId || undefined} options={channels.map((channel) => ({ value: channel.id, label: channel.name }))} onChange={(value) => change("channelId", value)} />
            <Choice clearable aria-label={t("workspace.model")} placeholder={t("workspace.model")} value={filters.modelId || undefined} options={channels.filter((channel) => !filters.channelId || channel.id === filters.channelId).flatMap((channel) => channel.models.map((model) => ({ value: model.id, label: `${channel.name} / ${model.label}` })))} onChange={(value) => change("modelId", value)} />
            <Choice clearable aria-label={t("workspace.type")} placeholder={t("workspace.type")} value={filters.capability || undefined} options={capabilities.map((value) => ({ value, label: t(value === "audio" ? "modelScripts.tts" : `workspace.${value}`) }))} onChange={(value) => change("capability", value)} />
        </div>

        {customIncomplete ? <Notice type="info" title={t("usage.customRequired")} /> : null}
        {customInvalid ? <Notice type="error" title={t("usage.customInvalid")} /> : null}
        {!rangeInvalid && query.error ? <Notice type="error" title={query.error.message} action={<Button onClick={() => void query.refetch()}>{t("workspace.retry")}</Button>} /> : null}
        {!rangeInvalid ? <>
            <p className="text-sm text-muted-foreground">{t("usage.callCount")} <span className="ml-2 font-medium tabular-nums text-foreground">{data?.summary.callCount.toLocaleString(locale) ?? "—"}</span></p>
            <DataTable<UsageModel> rowId={(row) => `${row.channelId}:${row.modelId}:${row.capability}`} rows={data?.summary.byModel} loading={query.isLoading} failed={query.isError} pageSize={20} empty={<EmptyState description={t("usage.empty")} />} columns={[
                { title: t("workspace.channelModel"), render: (_, row) => <span className="break-all">{modelLabel(row.channelId, row.modelId)}</span> },
                { title: t("workspace.type"), render: (_, row) => t(row.capability === "audio" ? "modelScripts.tts" : `workspace.${row.capability}`) },
                { title: t("usage.callCount"), align: "right", render: (_, row) => <span className="tabular-nums">{row.callCount.toLocaleString(locale)}</span> },
            ]} />
        </> : null}
    </section>;
}

function rangeWindow(range: RangeKey, anchor: Date, customFrom: string, customTo: string, timeZone: string) {
    if (range === "custom") return { from: localInputToISO(customFrom), to: localInputToISO(customTo) };
    const to = anchor.toISOString();
    if (range === "today") return { from: startOfToday(anchor, timeZone).toISOString(), to };
    const hours = range === "last24h" ? 24 : range === "days7" ? 24 * 7 : 24 * 30;
    return { from: new Date(anchor.getTime() - hours * 60 * 60 * 1000).toISOString(), to };
}

function startOfToday(date: Date, timeZone: string) {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
    const value = (type: "year" | "month" | "day") => Number(parts.find((part) => part.type === type)?.value);
    return new Date(value("year"), value("month") - 1, value("day"), 0, 0, 0, 0);
}

function datetimeLocal(date: Date) {
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function localInputToISO(value: string) {
    if (!value) return "";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}
