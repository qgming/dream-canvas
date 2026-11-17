import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Notice, Badge } from "@/components/ui/display";
import { DataTable } from "@/components/ui/data-table";
import { Dialog, Sheet } from "@/components/ui/dialog";
import { Choice } from "@/components/ui/choice";
import { EditorForm, Field } from "@/components/ui/form";
import { Input, Textarea } from "@/components/ui/input";
import { useAuthStore } from "@/stores/use-auth-store";
import { useConfigStore } from "@/stores/use-config-store";
import { getUsage, correctUsage, usageCorrections, type UsageEntry } from "@/services/api/runtime";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { captureSession } from "@/services/api/client";
import { decimalAmount, integerAmount, formatAmount } from "./amounts";

export default function UsagePage() {
    const { t, i18n } = useTranslation();
    const admin = useAuthStore((state) => state.user?.role === "admin");
    const channels = useConfigStore((state) => state.config.channels);
    const projects = useCanvasStore((state) => state.projects);
    const [filters, setFilters] = useState({ userId: "", projectId: "", channelId: "", modelId: "", capability: "", from: "", to: "" });
    const query = useQuery({ queryKey: ["usage", admin, filters], queryFn: () => getUsage(admin, { ...filters, from: filters.from ? new Date(filters.from).toISOString() : "", to: filters.to ? new Date(filters.to).toISOString() : "" }) });
    const [auditId, setAuditId] = useState("");
    const audit = useQuery({ queryKey: ["usage-corrections", auditId], queryFn: () => usageCorrections(auditId), enabled: Boolean(admin && auditId) });
    const [correction, setCorrection] = useState<UsageEntry | null>(null);
    const [busy, setBusy] = useState(false);
    useEffect(() => { const refresh = (event: Event) => { const topic = (event as CustomEvent<string>).detail; if (!topic || topic === "all") void query.refetch(); }; window.addEventListener("server-changed", refresh); return () => window.removeEventListener("server-changed", refresh); }, [query.refetch]);
    const money = (value: string | null) => value == null ? t("usage.unknown") : formatAmount(value, 6, i18n.resolvedLanguage || "zh-CN", "CNY");
    const points = (value: string | null) => value == null ? t("usage.unknown") : formatAmount(value, 3, i18n.resolvedLanguage || "zh-CN");
    const change = (key: keyof typeof filters, value: string) => setFilters((current) => ({ ...current, [key]: value || "", ...(key === "channelId" ? { modelId: "" } : {}) }));
    return <section className="space-y-6">
        <PageHeader title={t("usage.title")} description={t("usage.description")} actions={<Button variant="ghost" loading={query.isFetching} onClick={() => void query.refetch()}>{t("workspace.refresh")}</Button>} />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {admin ? <Input aria-label={t("usage.user")} placeholder={t("usage.user")} value={filters.userId} onChange={(event) => change("userId", event.target.value)} /> : null}
            <Choice clearable aria-label={t("workspace.project")} placeholder={t("workspace.project")} value={filters.projectId || undefined} options={projects.map((project) => ({ value: project.id, label: project.title }))} onChange={(value) => change("projectId", value)} />
            <Choice clearable aria-label={t("workspace.channelModel")} placeholder={t("workspace.channelModel")} value={filters.channelId || undefined} options={channels.map((channel) => ({ value: channel.id, label: channel.name }))} onChange={(value) => change("channelId", value)} />
            <Choice clearable aria-label={t("workspace.model")} placeholder={t("workspace.model")} value={filters.modelId || undefined} options={channels.filter((channel) => !filters.channelId || channel.id === filters.channelId).flatMap((channel) => channel.models.map((model) => ({ value: model.id, label: `${channel.name} / ${model.label}` })))} onChange={(value) => change("modelId", value)} />
            <Choice clearable aria-label={t("workspace.type")} placeholder={t("workspace.type")} value={filters.capability || undefined} options={["text", "image", "video", "audio"].map((value) => ({ value, label: t(`workspace.${value}`) }))} onChange={(value) => change("capability", value)} />
            <label className="text-xs text-muted-foreground">{t("usage.from")}<Input type="datetime-local" value={filters.from} onChange={(event) => change("from", event.target.value)} /></label>
            <label className="text-xs text-muted-foreground">{t("usage.to")}<Input type="datetime-local" value={filters.to} onChange={(event) => change("to", event.target.value)} /></label>
        </div>
        {query.error ? <Notice type="error" title={query.error.message} action={<Button onClick={() => void query.refetch()}>{t("workspace.retry")}</Button>} /> : null}
        {query.data ? <p className="text-sm text-muted-foreground">{t("usage.totals", { cost: money(query.data.costMicros), points: points(query.data.pointsMilli), unknown: query.data.unknownCostCount, unknownPoints: query.data.unknownPointsCount })}</p> : null}
        <DataTable<UsageEntry> rowId="id" rows={query.data?.entries} loading={query.isLoading} failed={query.isError} pageSize={20} columns={[
            { title: t("workspace.submittedAt"), render: (_, row) => new Date(row.createdAt).toLocaleString(i18n.resolvedLanguage) },
            { title: t("workspace.channelModel"), render: (_, row) => { const channel = channels.find((item) => item.id === row.channelId); return `${channel?.name || row.channelId} / ${channel?.models.find((item) => item.id === row.modelId)?.label || row.modelId}`; } },
            ...(admin ? [{ title: t("usage.user"), dataIndex: "userId" as const }] : []),
            { title: t("usage.basis"), render: (_, row) => <Badge>{t(`usage.${row.state}`)}</Badge> },
            { title: t("usage.details"), render: (_, row) => <details><summary className="cursor-pointer">{t("workspace.details")}</summary><pre className="mt-2 max-w-xs whitespace-pre-wrap text-xs">{JSON.stringify({ usage: row.usage, pricing: row.pricing }, null, 2)}</pre></details> },
            { title: t("usage.cost"), render: (_, row) => <div>{money(row.costMicros)}{row.currency && row.currency !== "CNY" && row.originalCostMicros != null ? <p className="text-xs text-muted-foreground">{formatAmount(row.originalCostMicros, 6, i18n.resolvedLanguage || "zh-CN")} {row.currency}</p> : null}</div> },
            { title: t("usage.costBasis"), render: (_, row) => <Badge>{t(`usage.${row.costState}`)}</Badge> },
            { title: t("usage.points"), render: (_, row) => points(row.pointsMilli) },
            ...(admin ? [{ title: t("workspace.actions"), render: (_: unknown, row: UsageEntry) => <div className="flex"><Button variant="ghost" size="sm" onClick={() => setCorrection(row)}>{t("usage.correct")}</Button><Button variant="ghost" size="sm" onClick={() => setAuditId(row.id)}>{t("usage.audit")}</Button></div> }] : []),
        ]} />
        <Dialog title={t("usage.correct")} open={Boolean(correction)} busy={busy} onClose={() => setCorrection(null)} footer={<Button type="submit" form="usage-correction" loading={busy}>{t("workspace.save")}</Button>}>
            {correction ? <EditorForm key={correction.id} id="usage-correction" initialValues={{ cost: correction.costMicros == null ? "" : decimalAmount(correction.costMicros, 6), points: correction.pointsMilli == null ? "" : decimalAmount(correction.pointsMilli, 3), reason: "" }} onSubmit={async (values) => {
                const assertSession = captureSession(); setBusy(true);
                try { await correctUsage(correction.id, { costMicros: integerAmount(values.cost, 6), pointsMilli: integerAmount(values.points, 3), reason: values.reason }); assertSession(); setCorrection(null); await query.refetch(); }
                finally { setBusy(false); }
            }}>
                <Notice type="info" title={t("usage.correctionHint")} />
                <Field name="cost" label={t("usage.costYuan")} schema={z.string().regex(/^(?:\d+(?:\.\d{1,6})?)?$/)}><Input inputMode="decimal" /></Field>
                <Field name="points" label={t("usage.points")} schema={z.string().regex(/^(?:\d+(?:\.\d{1,3})?)?$/)}><Input inputMode="decimal" /></Field>
                <Field name="reason" label={t("usage.reason")} schema={z.string().trim().min(1)}><Textarea /></Field>
            </EditorForm> : null}
        </Dialog>
        <Sheet title={t("usage.audit")} open={Boolean(auditId)} onClose={() => setAuditId("")}>
            {audit.error ? <Notice type="error" title={audit.error.message} action={<Button onClick={() => void audit.refetch()}>{t("workspace.retry")}</Button>} /> : null}
            <DataTable rowId="id" rows={audit.data} loading={audit.isLoading} failed={audit.isError} columns={[
                { title: t("workspace.submittedAt"), render: (_, row) => new Date(row.createdAt).toLocaleString(i18n.resolvedLanguage) },
                { title: t("usage.user"), dataIndex: "adminId" },
                { title: t("usage.reason"), dataIndex: "reason" },
                { title: t("usage.beforeAfter"), render: (_, row) => <div className="text-xs">{money(row.before.costMicros)} / {points(row.before.pointsMilli)} → {money(row.after.costMicros)} / {points(row.after.pointsMilli)}</div> },
            ]} />
        </Sheet>
    </section>;
}
