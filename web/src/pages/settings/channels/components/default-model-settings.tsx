import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Choice } from "@/components/ui/choice";
import { Notice, Spinner } from "@/components/ui/display";
import { EditorForm, Field, useEditorForm, useWatch } from "@/components/ui/form";
import { useDiscardChanges } from "@/hooks/use-discard-changes";
import { useFeedback } from "@/hooks/use-feedback";
import { modelCatalog, saveModelDefaults, type Capability, type ModelCatalog, type ModelDefaults } from "@/services/api/channels";
import { ApiError, captureSession } from "@/services/api/client";
import { useAuthStore } from "@/stores/use-auth-store";

const groups = [
    { capability: "text", label: "defaultTextModel" },
    { capability: "image", label: "defaultImageModel" },
    { capability: "video", label: "defaultVideoModel" },
    { capability: "audio", label: "defaultAudioModel" },
] as const;

export function DefaultModelSettings() {
    const { t } = useTranslation();
    const { notify } = useFeedback();
    const client = useQueryClient();
    const owner = useAuthStore((state) => state.user?.id);
    const query = useQuery({ queryKey: ["model-catalog", owner], queryFn: modelCatalog });
    const form = useEditorForm<ModelDefaults>({ version: 0, models: { text: "", image: "", video: "", audio: "" } });
    const models = useWatch({ control: form.control, name: "models" });
    const { isDirty: dirty, isSubmitting: busy } = form.formState;
    useEffect(() => { if (query.data && !dirty) form.reset(query.data.defaults); }, [query.data, dirty, form]);
    const reload = useDiscardChanges(dirty, async () => {
        const assertSession = captureSession();
        const result = await query.refetch({ throwOnError: true });
        assertSession();
        if (result.data) form.reset(result.data.defaults);
    });
    const options = (capability: Capability) => (query.data?.channels || []).flatMap((channel) => channel.models.filter((model) => model.capability === capability).map((model) => ({ value: model.id, label: `${model.name || model.model}（${channel.name}）` })));
    const unavailable = (capability: Capability) => Boolean(models?.[capability] && !options(capability).some((option) => option.value === models[capability]));
    const conflict = Boolean(query.data && dirty && query.data.defaults.version !== form.getValues("version"));
    return <section className="space-y-3">
        <div><h2 className="text-base font-medium">{t("config.preferences.defaultModels")}</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">{t("config.preferences.adminDefaultsDescription")}</p></div>
        {query.error ? <Notice type="error" title={query.error.message} action={<Button disabled={busy} onClick={reload}>{t("workspace.retry")}</Button>} /> : null}
        {query.isLoading ? <Spinner label={t("settings.loading")} /> : null}
        {query.data ? <EditorForm form={form} disabled={busy} className="space-y-0" onSubmit={async (values: ModelDefaults) => {
            const assertSession = captureSession();
            try {
                const record = await saveModelDefaults(values);
                assertSession();
                client.setQueryData<ModelCatalog>(["model-catalog", owner], (catalog) => catalog ? { ...catalog, defaults: record } : catalog);
                form.reset(record);
                notify.success(t("config.preferences.defaultModelsSaved"));
                await client.invalidateQueries({ queryKey: ["model-catalog"] });
            } catch (failure) {
                if (failure instanceof ApiError && failure.code === "version_conflict") void query.refetch();
                throw failure;
            }
        }}>
            {groups.map(({ capability, label }) => <Field key={capability} layout="horizontal" name={`models.${capability}`} label={t(`config.preferences.${label}`)} schema={z.string()}>
                <Choice searchable options={[{ value: "", label: t("config.preferences.defaultModelNotSet") }, ...options(capability), ...(unavailable(capability) ? [{ value: models[capability], label: t("config.preferences.defaultModelUnavailable"), disabled: true }] : [])]} />
            </Field>)}
            {conflict ? <Notice type="warning" title={t("config.preferences.defaultModelsConflict")} /> : null}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-3">
                <span role="status" className="text-xs text-muted-foreground">{t(dirty ? "workspace.unsaved" : "workspace.allSaved")}</span>
                <div className="ml-auto flex gap-2"><Button variant="ghost" disabled={busy} onClick={reload}>{t("workspace.reload")}</Button><Button type="submit" loading={busy} disabled={!dirty || conflict || Boolean(query.error) || groups.some(({ capability }) => unavailable(capability))}>{t("common.save")}</Button></div>
            </div>
        </EditorForm> : null}
    </section>;
}
