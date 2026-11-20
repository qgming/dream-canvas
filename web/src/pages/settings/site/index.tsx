import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/controls";
import { Notice, Spinner } from "@/components/ui/display";
import { Field } from "@/components/ui/form";
import { NumberInput } from "@/components/ui/input";
import { useEditGuard } from "@/hooks/use-edit-guard";
import { useFeedback } from "@/hooks/use-feedback";
import { ApiError, captureSession } from "@/services/api/client";
import { getSiteSettings, saveSiteSettings, type SiteSettings } from "@/services/api/runtime";

const slots = ["assistantSlots", "generationSlots", "userSlots"] as const;
type Draft = Omit<SiteSettings, typeof slots[number]> & Record<typeof slots[number], number | null>;

export default function SitePage() {
    const { t } = useTranslation();
    const { confirm } = useFeedback();
    const queryClient = useQueryClient();
    const query = useQuery({ queryKey: ["site-settings"], queryFn: getSiteSettings, refetchOnWindowFocus: false, refetchOnReconnect: false });
    const [draft, setDraft] = useState<Draft | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<unknown>(null);
    const operation = useRef(false);
    const settings = draft ?? query.data;
    const conflict = error instanceof ApiError && error.code === "version_conflict";
    const valid = (value: Draft): value is SiteSettings => slots.every((key) => Number.isSafeInteger(value[key]) && Number(value[key]) > 0);
    const errorText = (error: unknown) => error instanceof ApiError ? t(`site.errors.${error.code}`, { defaultValue: error.message }) : error instanceof Error ? error.message : t("ui.operationFailed");
    useEditGuard(Boolean(draft), () => { setDraft(null); setError(null); });
    useEffect(() => {
        const changed = () => { if (!operation.current) void queryClient.invalidateQueries({ queryKey: ["site-settings"] }); };
        window.addEventListener("server-changed", changed);
        return () => window.removeEventListener("server-changed", changed);
    }, [queryClient]);

    const save = async (next: Draft, confirmed = !next.open) => {
        if (operation.current) return;
        setDraft(next);
        if (!valid(next)) { setError(new Error(t("site.invalidSlots"))); return; }
        if (JSON.stringify(next) === JSON.stringify(query.data)) { setDraft(null); setError(null); return; }
        operation.current = true; setBusy(true); setError(null);
        const assertSession = captureSession();
        try {
            await queryClient.cancelQueries({ queryKey: ["site-settings"] }); assertSession();
            const saved = await saveSiteSettings(next, confirmed); assertSession();
            queryClient.setQueryData(["site-settings"], saved);
            queryClient.setQueryData(["auth-status"], (current: { initialized: boolean } | undefined) => current ? { ...current, open: saved.open } : undefined);
            setDraft(null);
        } catch (error) { setError(error); }
        finally { operation.current = false; setBusy(false); }
    };
    const reload = async () => {
        if (operation.current) return;
        operation.current = true; setBusy(true);
        const assertSession = captureSession();
        try { const result = await query.refetch(); assertSession(); if (result.error) throw result.error; setDraft(null); setError(null); }
        catch (error) { setError(error); }
        finally { operation.current = false; setBusy(false); }
    };
    const toggle = (open: boolean) => {
        if (!settings) return;
        const next = { ...settings, open };
        if (open) void save(next);
        else confirm({ title: t("site.closeTitle"), content: t("site.closeDescription"), confirmText: t("site.close"), destructive: true, onConfirm: () => save(next, true) });
    };

    if (query.isLoading) return <Spinner />;
    return <section className="space-y-6">
        <PageHeader title={t("site.title")} />
        {query.error ? <Notice type="error" title={errorText(query.error)} action={<Button loading={busy} onClick={() => void reload()}>{t("workspace.retry")}</Button>} /> : null}
        {error ? <Notice type={conflict ? "warning" : "error"} title={conflict ? t("site.conflict") : errorText(error)} action={<Button disabled={busy} onClick={() => { if (conflict || !draft) void reload(); else void save(draft); }}>{t(conflict ? "workspace.reload" : "workspace.retry")}</Button>} /> : null}
        {settings ? <div className="space-y-8" aria-busy={busy}>
            <Field layout="horizontal" className="grid-cols-[minmax(0,1fr)_auto] items-center" label={t("site.open")}><Switch checked={settings.open} disabled={busy || Boolean(draft) || query.isError || conflict} onChange={toggle} /></Field>
            <section>
                <h2 className="mb-2 text-base font-semibold">{t("site.concurrency")}</h2>
                {slots.map((key) => <Field key={key} layout="horizontal" label={t(`site.${key}`)}>
                    <NumberInput className="w-24" min={1} step={1} value={settings[key]} disabled={busy || query.isError || conflict} onChange={(value) => { setDraft({ ...settings, [key]: value }); setError(null); }} onBlur={() => { if (draft) void save(draft); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }} />
                </Field>)}
            </section>
        </div> : null}
    </section>;
}
