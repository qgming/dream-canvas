import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ChevronDown, RefreshCw } from "lucide-react";
import { Collapsible } from "@animate-ui/react/primitives/radix-ui";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Badge, EmptyState, FilterChip, Notice } from "@/components/ui/display";
import { DataTable } from "@/components/ui/data-table";
import { Choice } from "@/components/ui/choice";
import { Input } from "@/components/ui/input";
import { Tabs } from "@/components/ui/tabs";
import { useAuthStore } from "@/stores/use-auth-store";
import { useConfigStore } from "@/stores/use-config-store";
import { getUsage, type UsageEntry } from "@/services/api/runtime";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";

type RangeKey = "today" | "last24h" | "days7" | "days30" | "custom";
type FilterKey = "userId" | "projectId" | "channelId" | "modelId" | "capability" | "from" | "to";
type UsageModel = Awaited<ReturnType<typeof getUsage>>["summary"]["byModel"][number];

const ranges: RangeKey[] = ["today", "last24h", "days7", "days30", "custom"];
const capabilities = ["text", "image", "video", "audio"];

export default function UsagePage() {
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
    const [filters, setFilters] = useState<Record<FilterKey, string>>({ userId: "", projectId: "", channelId: "", modelId: "", capability: "", from: "", to: "" });
    const [tab, setTab] = useState("models");

    const timeWindow = useMemo(() => rangeWindow(range, anchor, customFrom, customTo, timeZone), [range, anchor, customFrom, customTo, timeZone]);
    const queryFilters = { ...filters, ...timeWindow, timeZone };
    const customIncomplete = range === "custom" && (!timeWindow.from || !timeWindow.to);
    const customInvalid = range === "custom" && !customIncomplete && new Date(timeWindow.from).getTime() >= new Date(timeWindow.to).getTime();
    const rangeInvalid = customIncomplete || customInvalid;
    const query = useQuery({
        queryKey: ["usage", admin, queryFilters],
        queryFn: () => getUsage(admin, queryFilters),
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

    return <section className="space-y-6">
        <PageHeader title={t("usage.title")} description={t("usage.description")} actions={<>
            <span className="text-xs text-muted-foreground">{timeZone}</span>
            <Button variant="outline" icon={<RefreshCw />} loading={!rangeInvalid && query.isFetching} disabled={rangeInvalid} onClick={refresh}>{t("workspace.refresh")}</Button>
        </>} />

        <div className="flex flex-wrap items-center gap-1" aria-label={t("usage.rangeLabel")}>
            {ranges.map((value) => <FilterChip key={value} checked={range === value} onChange={() => chooseRange(value)}>{t(`usage.ranges.${value}`)}</FilterChip>)}
        </div>
        {range === "custom" ? <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-xs text-muted-foreground"><span>{t("usage.from")}</span><Input type="datetime-local" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} /></label>
            <label className="space-y-1 text-xs text-muted-foreground"><span>{t("usage.to")}</span><Input type="datetime-local" value={customTo} onChange={(event) => setCustomTo(event.target.value)} /></label>
        </div> : null}

        <div className="grid grid-cols-2 divide-x divide-border border-y border-border py-3">
            <Metric label={t("usage.callCount")} value={data?.summary.callCount.toLocaleString(locale) ?? "-"} />
            <Metric label={t("usage.pending")} value={data?.summary.pendingCount.toLocaleString(locale) ?? "-"} />
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {admin ? <label className="space-y-1 text-xs text-muted-foreground"><span>{t("usage.user")}</span><Input placeholder={t("usage.userFilterHint")} value={filters.userId} onChange={(event) => change("userId", event.target.value)} /></label> : null}
            <Choice clearable aria-label={t("workspace.project")} placeholder={t("workspace.project")} value={filters.projectId || undefined} options={projects.map((project) => ({ value: project.id, label: project.title }))} onChange={(value) => change("projectId", value)} />
            <Choice clearable aria-label={t("workspace.channelModel")} placeholder={t("workspace.channelModel")} value={filters.channelId || undefined} options={channels.map((channel) => ({ value: channel.id, label: channel.name }))} onChange={(value) => change("channelId", value)} />
            <Choice clearable aria-label={t("workspace.model")} placeholder={t("workspace.model")} value={filters.modelId || undefined} options={channels.filter((channel) => !filters.channelId || channel.id === filters.channelId).flatMap((channel) => channel.models.map((model) => ({ value: model.id, label: `${channel.name} / ${model.label}` })))} onChange={(value) => change("modelId", value)} />
            <Choice clearable aria-label={t("workspace.type")} placeholder={t("workspace.type")} value={filters.capability || undefined} options={capabilities.map((value) => ({ value, label: t(value === "audio" ? "modelScripts.tts" : `workspace.${value}`) }))} onChange={(value) => change("capability", value)} />
        </div>

        {customIncomplete ? <Notice type="info" title={t("usage.customRequired")} /> : null}
        {customInvalid ? <Notice type="error" title={t("usage.customInvalid")} /> : null}
        {!rangeInvalid && query.error ? <Notice type="error" title={query.error.message} action={<Button onClick={() => void query.refetch()}>{t("workspace.retry")}</Button>} /> : null}
        {!rangeInvalid ? <Tabs value={tab} onValueChange={setTab} items={[
            {
                key: "models",
                label: t("usage.byModel"),
                children: <DataTable<UsageModel> rowId={(row) => `${row.channelId}:${row.modelId}:${row.capability}`} rows={data?.summary.byModel} loading={query.isLoading} failed={query.isError} empty={<EmptyState description={t("usage.empty")} />} columns={[
                    { title: t("workspace.channelModel"), render: (_, row) => <span className="break-all">{modelLabel(row.channelId, row.modelId)}</span> },
                    { title: t("workspace.type"), render: (_, row) => t(row.capability === "audio" ? "modelScripts.tts" : `workspace.${row.capability}`) },
                    { title: t("usage.callCount"), align: "right", render: (_, row) => <span className="tabular-nums">{row.callCount.toLocaleString(locale)}</span> },
                    { title: t("usage.pending"), align: "right", render: (_, row) => <span className="tabular-nums">{row.pendingCount.toLocaleString(locale)}</span> },
                ]} />,
            },
            {
                key: "calls",
                label: t("usage.details"),
                children: <DataTable<UsageEntry> rowId="id" rows={data?.entries} loading={query.isLoading} failed={query.isError} empty={<EmptyState description={t("usage.empty")} />} pageSize={20} columns={[
                    { title: t("usage.startedAt"), render: (_, row) => <span className="whitespace-nowrap text-xs tabular-nums">{new Date(row.startedAt).toLocaleString(locale)}</span> },
                    { title: t("workspace.channelModel"), render: (_, row) => <div className="min-w-40"><div className="break-all">{modelLabel(row.channelId, row.modelId)}</div><div className="mt-1 text-xs text-muted-foreground">{t(row.capability === "audio" ? "modelScripts.tts" : `workspace.${row.capability}`)}</div></div> },
                    ...(admin ? [{ title: t("usage.user"), dataIndex: "userId" as const }] : []),
                    { title: t("usage.basis"), render: (_, row) => <div className="flex flex-wrap gap-1"><Badge color={row.state === "actual" ? "success" : row.state === "estimated" ? "warning" : undefined}>{t(`usage.${row.state}`)}</Badge></div> },
                    { title: t("usage.details"), render: (_, row) => <UsageDetails row={row} /> },
                ]} />,
            },
        ]} /> : null}

    </section>;
}

function Metric({ label, value }: { label: ReactNode; value: ReactNode }) {
    return <dl className="min-w-0 px-4 first:pl-0 last:pr-0">
        <dt className="text-xs text-muted-foreground">{label}</dt>
        <dd className="mt-1 truncate text-lg font-semibold tabular-nums">{value}</dd>
    </dl>;
}

function UsageDetails({ row }: { row: UsageEntry }) {
    const { t } = useTranslation();
    const expandable = Boolean(Object.keys(row.usage || {}).length);
    if (!expandable) return <span className="text-xs text-muted-foreground">{t("workspace.details")}</span>;
    return <Collapsible.Root className="group min-w-52">
        <Collapsible.Trigger asChild>
            <button type="button" className="flex w-full items-center justify-between gap-2 rounded-sm text-left text-xs text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {t("workspace.details")}
                <ChevronDown className="size-3.5 shrink-0 transition-transform group-data-[state=open]:rotate-180" />
            </button>
        </Collapsible.Trigger>
        <Collapsible.Content>
            <div className="mt-3 space-y-3 rounded-lg border border-border bg-card p-3">
                <ReadableObject title={t("usage.usage")} value={row.usage} />
            </div>
        </Collapsible.Content>
    </Collapsible.Root>;
}

function ReadableObject({ title, value }: { title: string; value: object }) {
    const { t } = useTranslation();
    const entries = Object.entries(value || {});
    return <section>
        <h3 className="mb-2 text-xs font-medium">{title}</h3>
        {entries.length ? <dl className="space-y-1.5 text-xs">
            {entries.map(([key, entry]) => <div key={key} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3">
                <dt className="break-all text-muted-foreground">{t(`usage.units.${key}`, { defaultValue: humanize(key) })}</dt>
                <dd className="text-right break-all tabular-nums">{readableValue(entry, t)}</dd>
            </div>)}
        </dl> : <p className="text-xs text-muted-foreground">{t("usage.unknown")}</p>}
    </section>;
}

function readableValue(value: unknown, t: (key: string, options?: Record<string, unknown>) => string): string {
    if (value == null || value === "") return t("usage.unknown");
    if (typeof value === "boolean") return t(value ? "workspace.enabled" : "workspace.disabled");
    if (typeof value !== "object") return String(value);
    if (Array.isArray(value)) return value.length ? value.map((entry) => readableValue(entry, t)).join(" · ") : t("usage.unknown");
    const record = value as Record<string, unknown>;
    return Object.entries(record).map(([key, entry]) => `${t(`usage.units.${key}`, { defaultValue: humanize(key) })} ${readableValue(entry, t)}`).join(" · ");
}

function humanize(value: string) {
    return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
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
