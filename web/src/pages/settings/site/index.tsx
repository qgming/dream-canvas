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
import { authStatusKey, type AuthStatus, type SiteAvailability } from "@/services/api/auth";
import { ApiError, captureSession } from "@/services/api/client";
import { getSiteSettings, saveSiteSettings, scriptRuntimeFields, type SiteSettings } from "@/services/api/runtime";

const slots = ["assistantSlots", "generationSlots", "userSlots"] as const;
const availabilityFields = [["open", "site.open"], ["imageWorkbenchOpen", "navigation.image"], ["videoWorkbenchOpen", "navigation.video"]] as const;
type RuntimeField = typeof scriptRuntimeFields[number];
type Draft = Omit<SiteSettings, typeof slots[number] | "scriptRuntime"> & Record<typeof slots[number], number | null> & { scriptRuntime: Record<RuntimeField, number | null> };

export default function SitePage() {
    const { t } = useTranslation();
    const { confirm } = useFeedback();
    const queryClient = useQueryClient();
    const query = useQuery({ queryKey: ["site-settings"], queryFn: getSiteSettings, refetchOnWindowFocus: false, refetchOnReconnect: false });
    const [draft, setDraft] = useState<Draft | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<unknown>(null);
    const operation = useRef(false);
    const changedDuringSave = useRef(false);
    const settings = draft ?? query.data;
    const conflict = error instanceof ApiError && error.code === "version_conflict";
    const available = Boolean(query.data && availabilityFields.every(([key]) => typeof query.data?.[key] === "boolean") && scriptRuntimeFields.every((key) => Number.isSafeInteger(query.data?.scriptRuntime?.[key]) && query.data?.scriptRuntimeBounds?.[key]));
    const valid = (value: Draft): value is SiteSettings => slots.every((key) => Number.isSafeInteger(value[key]) && Number(value[key]) > 0) && scriptRuntimeFields.every((key) => {
        const { min, max } = value.scriptRuntimeBounds[key];
        const number = value.scriptRuntime[key];
        return number !== null && Number.isSafeInteger(number) && number >= min && number <= max;
    });
    const errorText = (error: unknown) => error instanceof ApiError ? t(`site.errors.${error.code}`, { defaultValue: error.message }) : error instanceof Error ? error.message : t("ui.operationFailed");
    useEditGuard(Boolean(draft), () => { setDraft(null); setError(null); });
    useEffect(() => {
        const changed = (event: Event) => {
            const topic = (event as CustomEvent<string>).detail;
            if (topic && topic !== "all") return;
            if (operation.current) changedDuringSave.current = true;
            else void queryClient.invalidateQueries({ queryKey: ["site-settings"] });
        };
        window.addEventListener("server-changed", changed);
        return () => window.removeEventListener("server-changed", changed);
    }, [queryClient]);

    const save = async (next: Draft, confirmed = !next.open) => {
        if (operation.current || !available) return;
        setDraft(next);
        if (!valid(next)) { setError(new Error(t(slots.some((key) => !Number.isSafeInteger(next[key]) || Number(next[key]) < 1) ? "site.invalidSlots" : "site.invalidRuntime"))); return; }
        if (JSON.stringify(next) === JSON.stringify(query.data)) { setDraft(null); setError(null); return; }
        operation.current = true; setBusy(true); setError(null);
        const assertSession = captureSession();
        try {
            await queryClient.cancelQueries({ queryKey: ["site-settings"] }); assertSession();
            const saved = await saveSiteSettings(next, confirmed); assertSession();
            await queryClient.cancelQueries({ queryKey: authStatusKey }); assertSession();
            queryClient.setQueryData(["site-settings"], saved);
            queryClient.setQueryData<AuthStatus>(authStatusKey, (current) => current ? { ...current, open: saved.open, imageWorkbenchOpen: saved.imageWorkbenchOpen, videoWorkbenchOpen: saved.videoWorkbenchOpen } : undefined);
            void queryClient.invalidateQueries({ queryKey: authStatusKey });
            setDraft(null);
        } catch (error) { setError(error); }
        finally {
            operation.current = false; setBusy(false);
            if (changedDuringSave.current) { changedDuringSave.current = false; void queryClient.invalidateQueries({ queryKey: ["site-settings"] }); }
        }
    };
    const reload = async () => {
        if (operation.current) return;
        operation.current = true; setBusy(true);
        const assertSession = captureSession();
        try { const result = await query.refetch(); assertSession(); if (result.error) throw result.error; setDraft(null); setError(null); }
        catch (error) { setError(error); }
        finally {
            operation.current = false; setBusy(false);
            if (changedDuringSave.current) { changedDuringSave.current = false; void queryClient.invalidateQueries({ queryKey: ["site-settings"] }); }
        }
    };
    const toggle = (key: keyof SiteAvailability, open: boolean) => {
        if (!settings) return;
        const next = { ...settings, [key]: open };
        if (key !== "open" || open) void save(next);
        else confirm({ title: t("site.closeTitle"), content: t("site.closeDescription"), confirmText: t("site.close"), destructive: true, onConfirm: () => save(next, true) });
    };

    if (query.isLoading) return <Spinner />;
    return <section className="space-y-6">
        <PageHeader title={t("site.title")} />
        {query.error ? <Notice type="error" title={errorText(query.error)} action={<Button loading={busy} onClick={() => void reload()}>{t("workspace.retry")}</Button>} /> : null}
        {error ? <Notice type={conflict ? "warning" : "error"} title={conflict ? t("site.conflict") : errorText(error)} action={<Button disabled={busy} onClick={() => { if (conflict || !draft) void reload(); else void save(draft); }}>{t(conflict ? "workspace.reload" : "workspace.retry")}</Button>} /> : null}
        {settings && !available ? <Notice type="warning" title={t("site.updateBackend")} action={<Button loading={busy} onClick={() => void reload()}>{t("workspace.reload")}</Button>} /> : null}
        {settings && available ? <div className="space-y-8" aria-busy={busy}>
            <div>{availabilityFields.map(([key, label]) => <Field key={key} layout="horizontal" className="grid-cols-[minmax(0,1fr)_auto] items-center" label={t(label)}><Switch checked={settings[key]} disabled={busy || Boolean(draft) || query.isError || conflict} onChange={(open) => toggle(key, open)} /></Field>)}</div>
            <section>
                <h2 className="mb-2 text-base font-semibold">{t("site.concurrency")}</h2>
                {slots.map((key) => <Field key={key} layout="horizontal" label={t(`site.${key}`)}>
                    <NumberInput className="w-24" min={1} step={1} value={settings[key]} disabled={busy || query.isError || conflict} onChange={(value) => { setDraft({ ...settings, [key]: value }); setError(null); }} onBlur={() => { if (draft) void save(draft); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }} />
                </Field>)}
            </section>
            <section>
                <h2 className="mb-2 text-base font-semibold">{t("site.scriptRuntime")}</h2>
                {scriptRuntimeFields.map((key) => {
                    const limits = settings.scriptRuntimeBounds[key];
                    return <Field key={key} layout="horizontal" label={t(`site.runtime.${key}.label`)}
                        help={`${t(`site.runtime.${key}.help`)} ${t("site.runtimeRange", { min: limits.min, max: limits.max, value: limits.default })}`}>
                        <NumberInput className="w-24" min={limits.min} max={limits.max} step={1} value={settings.scriptRuntime[key]} disabled={busy || query.isError || conflict}
                            onChange={(value) => { setDraft({ ...settings, scriptRuntime: { ...settings.scriptRuntime, [key]: value } }); setError(null); }}
                            onBlur={() => { if (draft) void save(draft); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }} />
                    </Field>;
                })}
            </section>
        </div> : null}
    </section>;
}
