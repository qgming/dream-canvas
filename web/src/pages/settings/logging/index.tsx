import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { RefreshCw, Save } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/controls";
import { Notice, Spinner } from "@/components/ui/display";
import { EditorForm, Field, useEditorForm, useWatch } from "@/components/ui/form";
import { useFeedback } from "@/hooks/use-feedback";
import { captureSession } from "@/services/api/client";
import { getLogSettings, saveLogSettings, type LogSettings } from "@/services/api/logging";

export default function LoggingPage() {
    const { t } = useTranslation();
    const { notify, confirm } = useFeedback();
    const queryClient = useQueryClient();
    const query = useQuery({ queryKey: ["log-settings"], queryFn: getLogSettings });
    const form = useEditorForm<LogSettings>();
    const enabled = useWatch({ control: form.control, name: "enabled" });
    const dirty = form.formState.isDirty;
    const busy = form.formState.isSubmitting;
    useEffect(() => { if (query.data && !form.formState.isDirty && !form.formState.isSubmitting) form.reset(query.data); }, [query.data, form]);

    const reload = () => {
        const assertSession = captureSession();
        const read = async () => { assertSession(); const result = await query.refetch(); assertSession(); if (result.error) throw result.error; if (result.data) form.reset(result.data); };
        if (dirty) confirm({ title: t("logging.discardTitle"), content: t("logging.discardHint"), confirmText: t("workspace.discardAndReload"), onConfirm: read });
        else void read().catch((error) => notify.error(error instanceof Error ? error.message : t("workspace.readFailed")));
    };

    if (query.isLoading) return <Spinner />;
    return <section className="space-y-6">
        <PageHeader stickyActions title={t("logging.title")} description={t("logging.description")} actions={<>
            <span role="status" className="text-xs text-muted-foreground">{busy ? t("settings.savingChanges") : dirty ? t("workspace.unsaved") : query.data ? t("workspace.allSaved") : t("settings.loading")}</span>
            <Button variant="outline" icon={<RefreshCw />} disabled={busy || query.isFetching} onClick={reload}>{t("workspace.reload")}</Button>
            <Button variant="default" icon={<Save />} type="submit" form="logging-settings" loading={busy} disabled={!query.data || !dirty}>{t("workspace.save")}</Button>
        </>} />
        {query.error ? <Notice type="error" title={query.error.message} action={<Button disabled={busy || query.isFetching} onClick={reload}>{t("workspace.retry")}</Button>} /> : null}
        {query.data ? <EditorForm id="logging-settings" form={form} disabled={busy} className="space-y-8" onSubmit={async (values: LogSettings) => {
            const assertSession = captureSession();
            const saved = await saveLogSettings(values);
            assertSession();
            form.reset(saved);
            queryClient.setQueryData(["log-settings"], saved);
            notify.success(t("logging.saved"));
        }}>
            <section>
                <h2 className="mb-2 text-base font-medium">{t("logging.output")}</h2>
                <Field name="enabled" layout="horizontal" checked schema={z.boolean()} label={t("logging.enabled")} description={t("logging.enabledHint")}>
                    <Switch onChange={(checked) => { if (!checked) form.setValue("development", false, { shouldDirty: true }); }} />
                </Field>
                <Field name="development" layout="horizontal" checked schema={z.boolean()} label={t("logging.development")} description={t("logging.developmentHint")}><Switch disabled={!enabled} /></Field>
            </section>
            <Notice type="info" title={t("logging.destination")} description={t("logging.destinationHint")} />
        </EditorForm> : null}
    </section>;
}
