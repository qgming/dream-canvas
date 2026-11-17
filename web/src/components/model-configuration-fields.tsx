import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { Field, useFormContext, useWatch } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Choice } from "@/components/ui/choice";
import { Switch } from "@/components/ui/controls";
import { Notice } from "@/components/ui/display";
import { Button } from "@/components/ui/button";
import { ModelInputSettings, ModelPricingFields } from "@/components/model-input-settings";
import { getModelScript, listModelScripts, type Capability, type ModelInput } from "@/services/api/channels";

export const defaultAdapter = (capability: Capability) => ({ text: "openai-chat", image: "openai-image", audio: "openai-tts", video: "" })[capability];
export const blankModel = (capability: Capability = "image"): ModelInput => ({ model: "", name: "", capability, adapterId: defaultAdapter(capability), adapterVersionId: "", enabled: true, version: 0, parameterOverrides: {}, pricing: {} });

export function ModelConfigurationFields({ onCreateScript, onViewScript }: { onCreateScript: (capability: Capability) => void; onViewScript: (id: string) => void }) {
    const { t } = useTranslation();
    const form = useFormContext<ModelInput>();
    const capability = useWatch({ control: form.control, name: "capability" });
    const adapterId = useWatch({ control: form.control, name: "adapterId" });
    const versionId = useWatch({ control: form.control, name: "adapterVersionId" });
    const scripts = useQuery({ queryKey: ["model-scripts"], queryFn: listModelScripts });
    const script = useQuery({ queryKey: ["model-script", adapterId], queryFn: () => getModelScript(adapterId), enabled: Boolean(adapterId) });
    useEffect(() => { if (script.data?.script.id === adapterId && script.data.script.adapterVersionId && !form.getValues("adapterVersionId")) form.setValue("adapterVersionId", script.data.script.adapterVersionId); }, [adapterId, versionId, script.data]);
    const version = script.data?.versions.find((entry) => entry.id === versionId);
    return <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2"><Field name="model" label={t("workspace.providerModelId")} schema={z.string().trim().min(1)}><Input /></Field><Field name="name" label={t("workspace.displayName")} schema={z.string().trim().min(1)}><Input /></Field>
            <Field name="capability" label={t("workspace.type")}><Choice options={["text", "image", "video", "audio"].map((value) => ({ value, label: t(value === "audio" ? "modelScripts.tts" : `workspace.${value}`) }))} onChange={(next: Capability) => { form.setValue("adapterId", defaultAdapter(next), { shouldDirty: true }); form.setValue("adapterVersionId", "", { shouldDirty: true }); form.setValue("parameterOverrides", {}, { shouldDirty: true }); }} /></Field>
            <Field name="adapterId" label={t("modelScripts.callAdapter")} schema={z.string().min(1)}><Choice options={scripts.data?.filter((entry) => entry.capability === capability && entry.adapterVersionId).map((entry) => ({ value: entry.id, label: `${entry.name}${entry.builtin ? ` · ${t("modelScripts.builtin")}` : ""}` }))} onChange={() => { form.setValue("adapterVersionId", "", { shouldDirty: true }); form.setValue("parameterOverrides", {}, { shouldDirty: true }); }} /></Field>
        </div>
        {scripts.error || script.error ? <Notice type="error" title={(scripts.error || script.error)?.message} action={<Button onClick={() => { void scripts.refetch(); void script.refetch(); }}>{t("workspace.retry")}</Button>} /> : null}
        <div className="flex flex-wrap items-end gap-2"><div className="min-w-0 flex-1"><Field name="adapterVersionId" label={t("modelScripts.version")} schema={z.string().min(1)}><Choice options={script.data?.versions.map((entry) => ({ value: entry.id, label: `r${entry.draftRevision} · ${new Date(entry.createdAt).toLocaleString()}` }))} onChange={() => form.setValue("parameterOverrides", {}, { shouldDirty: true })} /></Field></div><Button variant="ghost" disabled={!adapterId} onClick={() => onViewScript(adapterId)}>{t("modelScripts.view")}</Button><Button variant="ghost" onClick={() => onCreateScript(capability)}>{t("modelScripts.create")}</Button></div>
        <Field name="enabled" label={t("workspace.enableModel")} checked><Switch /></Field>
        <section className="space-y-3"><h3 className="text-sm font-medium">{t("modelScripts.modelInputs")}</h3><Field name="parameterOverrides"><ModelInputSettings controls={version?.parameters || []} value={{}} onChange={() => undefined} /></Field></section>
        <section className="space-y-3"><h3 className="text-sm font-medium">{t("modelScripts.pricing")}</h3><Field name="pricing"><ModelPricingFields value={{}} onChange={() => undefined} /></Field></section>
    </div>;
}
