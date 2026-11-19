import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { Field, useFormContext, useWatch } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Choice } from "@/components/ui/choice";
import { Switch } from "@/components/ui/controls";
import { Notice, Spinner } from "@/components/ui/display";
import { Button } from "@/components/ui/button";
import { useDiscardChanges } from "@/hooks/use-discard-changes";
import { ModelInputSettings } from "@/components/model-input-settings";
import { getModelScript, listModelScripts, type Capability, type ModelInput } from "@/services/api/channels";

export type ModelConfigurationSection = "basic" | "parameters";
export const defaultAdapter = (capability: Capability) => ({ text: "openai-chat", image: "openai-image", audio: "openai-tts", video: "openai-video" })[capability];
export const blankModel = (capability: Capability = "image"): ModelInput => ({ model: "", name: "", capability, adapterId: defaultAdapter(capability), adapterVersionId: "", enabled: true, version: 0, parameterOverrides: {} });

export function ModelConfigurationFields({ section, onCreateScript, onViewScript }: { section: ModelConfigurationSection; onCreateScript: (capability: Capability) => void; onViewScript: (id: string) => void }) {
    const { t } = useTranslation();
    const form = useFormContext<ModelInput>();
    const capability = useWatch({ control: form.control, name: "capability" });
    const adapterId = useWatch({ control: form.control, name: "adapterId" });
    const versionId = useWatch({ control: form.control, name: "adapterVersionId" });
    const overrides = useWatch({ control: form.control, name: "parameterOverrides" }) || {};
    const scripts = useQuery({ queryKey: ["model-scripts"], queryFn: listModelScripts });
    const script = useQuery({ queryKey: ["model-script", adapterId], queryFn: () => getModelScript(adapterId), enabled: Boolean(adapterId) });
    useEffect(() => { if (script.data?.script.id === adapterId && script.data.script.adapterVersionId && !form.getValues("adapterVersionId")) form.setValue("adapterVersionId", script.data.script.adapterVersionId); }, [adapterId, script.data, form]);
    const version = script.data?.versions.find((entry) => entry.id === versionId);
    const useLatest = useDiscardChanges(Boolean(Object.keys(overrides).length), () => {
        form.setValue("adapterVersionId", script.data!.script.adapterVersionId, { shouldDirty: true });
        form.setValue("parameterOverrides", {}, { shouldDirty: true });
    });
    const error = scripts.error || script.error;
    const retry = () => { void scripts.refetch(); void script.refetch(); };

    if (section === "parameters") return <div className="space-y-4">
        {error ? <Notice type="error" title={error.message} action={<Button onClick={retry}>{t("workspace.retry")}</Button>} /> : null}
        {script.isLoading ? <Spinner label={t("settings.loading")} /> : null}
        {!error && version ? <Field key={`${adapterId}:${version.id}`} name="parameterOverrides"><ModelInputSettings controls={version.parameters} value={{}} onChange={() => undefined} /></Field> : null}
        {!script.isLoading && !error && !version ? <Notice type="error" title={t("modelScripts.versionMissing")} /> : null}
    </div>;

    return <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
            <Field name="model" label={t("workspace.providerModelId")} schema={z.string().trim().min(1)}><Input /></Field>
            <Field name="name" label={t("workspace.displayName")} schema={z.string().trim().min(1)}><Input /></Field>
            <Field name="capability" label={t("workspace.type")} schema={z.enum(["text", "image", "video", "audio"])}><Choice options={["text", "image", "video", "audio"].map((value) => ({ value, label: t(value === "audio" ? "modelScripts.tts" : `workspace.${value}`) }))} onChange={(next: Capability) => { form.setValue("adapterId", defaultAdapter(next), { shouldDirty: true }); form.setValue("adapterVersionId", "", { shouldDirty: true }); form.setValue("parameterOverrides", {}, { shouldDirty: true }); }} /></Field>
            <Field name="adapterId" label={t("modelScripts.callAdapter")} schema={z.string().min(1)}><Choice options={scripts.data?.filter((entry) => entry.capability === capability && entry.adapterVersionId).map((entry) => ({ value: entry.id, label: `${entry.name}${entry.builtin ? ` · ${t("modelScripts.builtin")}` : ""}` }))} onChange={() => { form.setValue("adapterVersionId", "", { shouldDirty: true }); form.setValue("parameterOverrides", {}, { shouldDirty: true }); }} /></Field>
        </div>
        {error ? <Notice type="error" title={error.message} action={<Button onClick={retry}>{t("workspace.retry")}</Button>} /> : null}
        <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-0 flex-1"><Field name="adapterVersionId" label={t("modelScripts.version")} schema={z.string().min(1)}><Choice options={script.data?.versions.map((entry) => ({ value: entry.id, label: `r${entry.draftRevision} · ${new Date(entry.createdAt).toLocaleString()}` }))} onChange={() => form.setValue("parameterOverrides", {}, { shouldDirty: true })} /></Field></div>
            <Button variant="ghost" disabled={!adapterId} onClick={() => onViewScript(adapterId)}>{t("modelScripts.view")}</Button>
            <Button variant="ghost" onClick={() => onCreateScript(capability)}>{t("modelScripts.create")}</Button>
        </div>
        {script.isLoading ? <Spinner label={t("settings.loading")} /> : null}
        {script.data ? <p className="text-xs leading-5 text-muted-foreground">{script.data.script.description}</p> : null}
        {versionId && script.data?.script.adapterVersionId && versionId !== script.data.script.adapterVersionId ? <Notice type="info" title={t("modelScripts.newVersionAvailable")} action={<Button onClick={useLatest}>{t("modelScripts.useLatest")}</Button>} /> : null}
        {!script.isLoading && !error && !version ? <Notice type="error" title={t("modelScripts.versionMissing")} /> : null}
        <Field name="enabled" label={t("workspace.enableModel")} checked><Switch /></Field>
    </div>;
}
