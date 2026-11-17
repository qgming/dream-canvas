import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Notice, Spinner } from "@/components/ui/display";
import { EditorForm, Field, useEditorForm } from "@/components/ui/form";
import { Input, NumberInput } from "@/components/ui/input";
import { Switch } from "@/components/ui/controls";
import { useFeedback } from "@/hooks/use-feedback";
import { captureSession } from "@/services/api/client";
import { getRuntime, saveRuntime, type ExecutionPolicy } from "@/services/api/runtime";

const groups: { name: string; keys: (keyof ExecutionPolicy)[] }[] = [
    { name: "concurrency", keys: ["assistantSlots", "generationSlots", "userSlots", "transferSlots", "previewSlots"] },
    { name: "timeouts", keys: ["connectSeconds", "querySeconds", "firstResponseSeconds", "idleSeconds", "textSeconds", "imageSeconds", "audioSeconds", "transferSeconds"] },
    { name: "recovery", keys: ["pollSeconds", "queryFailures", "maxWaitSeconds", "downloadRetrySeconds", "storageRetrySeconds", "signedUrlSeconds"] },
    { name: "limits", keys: ["imageBytes", "audioBytes", "videoBytes", "jsonBytes", "scriptSeconds", "scriptMemoryMiB"] },
];

export default function RuntimePage() {
    const { t } = useTranslation();
    const query = useQuery({ queryKey: ["runtime-settings"], queryFn: getRuntime });
    const form = useEditorForm();
    const { notify, confirm } = useFeedback();
    const [version, setVersion] = useState(0);
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        if (!query.data || form.formState.isDirty) return;
        const policy = query.data.record.policy || query.data.suggested;
        form.reset({ ...policy, downloadRetrySeconds: policy.downloadRetrySeconds.join(", "), storageRetrySeconds: policy.storageRetrySeconds.join(", ") });
        setVersion(query.data.record.version || 0);
    }, [query.data]);
    if (query.isLoading) return <Spinner />;
    return <section className="space-y-6">
        <PageHeader title={t("execution.title")} description={t("execution.description")} />
        <Notice type="info" title={t("execution.confirmPolicy")} description={t("execution.failurePolicy")} />
        {query.error ? <Notice type="error" title={query.error.message} action={<Button onClick={() => void query.refetch()}>{t("workspace.retry")}</Button>} /> : null}
        {query.data ? <EditorForm form={form} className="space-y-8" disabled={busy} onSubmit={async (values) => {
            const assertSession = captureSession();
            const policy: ExecutionPolicy = { ...values, downloadRetrySeconds: values.downloadRetrySeconds.trim() ? values.downloadRetrySeconds.split(",").map(Number) : [], storageRetrySeconds: values.storageRetrySeconds.split(",").map(Number) };
            const apply = async () => {
                setBusy(true);
                try { assertSession(); const record = await saveRuntime(version, policy); assertSession(); setVersion(record.version); form.reset(values); notify.success(t("execution.saved")); await query.refetch(); }
                finally { setBusy(false); }
            };
            await new Promise<void>((resolve, reject) => confirm({ title: t("execution.confirmSave"), content: t("execution.failurePolicy"), confirmText: t("workspace.save"), onConfirm: async () => { try { await apply(); resolve(); } catch (error) { reject(error); throw error; } }, onCancel: () => resolve() }));
        }}>
            <Field layout="horizontal" name="enabled" label={t("execution.enabled")} description={t("execution.enabledHint")} checked><Switch /></Field>
            {groups.map((group) => <section key={group.name}><h2 className="mb-2 text-base font-medium">{t(`execution.groups.${group.name}`)}</h2>{group.keys.map((key) => {
                const retries = key === "downloadRetrySeconds" || key === "storageRetrySeconds";
                return <Field key={key} layout="horizontal" name={key} label={t(`execution.fields.${key}`)} description={retries ? t("execution.retryHint") : undefined} schema={retries ? z.string().refine((value) => (key === "downloadRetrySeconds" && !value.trim()) || value.split(",").every((part) => part.trim() && Number.isSafeInteger(Number(part)) && Number(part) > 0), t("execution.invalidIntervals")) : z.number().int().positive()}>{retries ? <Input /> : <NumberInput step={1} />}</Field>;
            })}</section>)}
            <Field layout="horizontal" name="pointsPerYuan" label={t("execution.pointsRatio")} description={t("execution.pointsHint")} schema={z.string().regex(/^(?:\d+(?:\.\d+)?)?$/, t("ui.invalidValue"))}><Input inputMode="decimal" /></Field>
            <div className="flex justify-end"><Button type="submit" loading={busy}>{t("workspace.save")}</Button></div>
        </EditorForm> : null}
    </section>;
}
