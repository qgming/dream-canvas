import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { Dialog } from "@/components/ui/dialog";
import { EditorForm, Field, useEditorForm } from "@/components/ui/form";
import { Input, Textarea } from "@/components/ui/input";
import { Choice } from "@/components/ui/choice";
import { Switch } from "@/components/ui/controls";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/display";
import { ModelInputFields } from "@/components/model-parameters";
import { checkModelScript, listChannels, testModelScript, type ModelInput, type ModelScript, type ParameterControl, type ScriptCheck } from "@/services/api/channels";
import { useAssetStore } from "@/stores/use-asset-store";
import { useFeedback } from "@/hooks/use-feedback";
import { captureSession } from "@/services/api/client";

export function ModelScriptTestDialog({ script, controls, revision = 0, versionId, initial, preview, onClose, onQueued }: { script: ModelScript; controls: ParameterControl[]; revision?: number; versionId?: string; initial?: { channelId: string; model: ModelInput }; preview?: { files: Record<string, string>; baseUrl: string }; onClose: () => void; onQueued: (id: string) => void }) {
    const { t } = useTranslation();
    const { notify } = useFeedback();
    const channels = useQuery({ queryKey: ["admin-channels"], queryFn: listChannels });
    const form = useEditorForm();
    const assets = useAssetStore((state) => state.assets);
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState<ScriptCheck | null>(null);
    return <Dialog open title={t(preview ? "modelScripts.previewRequest" : "modelScripts.test")} description={t(preview ? "modelScripts.previewAssetsHint" : "modelScripts.testHint")} onClose={onClose} busy={busy} width={720} footer={<Button variant="default" type="submit" form="model-script-test" loading={busy}>{t(preview ? "modelScripts.previewRequest" : "modelScripts.submitTest")}</Button>}>
        {channels.error ? <Notice type="error" title={channels.error.message} action={<Button onClick={() => void channels.refetch()}>{t("workspace.retry")}</Button>} /> : null}
        <EditorForm id="model-script-test" form={form} initialValues={{ channelId: initial?.channelId || "", model: initial?.model.model || "", name: initial?.model.name || "", prompt: "", parameters: {}, references: [], confirmCharges: false }} onSubmit={async (values) => {
            const assertSession = captureSession(); setBusy(true);
            try {
                const model: ModelInput = { model: values.model, name: values.name || values.model, capability: script.capability, adapterId: script.id, adapterVersionId: initial?.model.adapterVersionId || versionId || script.adapterVersionId, parameterOverrides: initial?.model.parameterOverrides || {}, enabled: true, version: 0 };
                const references = (values.references as string[]).map((id) => { const asset = assets.find((entry) => entry.id === id); if (!asset) throw new Error(t("errors.assetMissing")); return { assetId: id, role: asset.kind }; });
                if (preview) {
                    const checked = await checkModelScript(preview.files, { model: model.model, prompt: values.prompt, params: values.parameters, images: references.filter((asset) => asset.role === "image"), videos: references.filter((asset) => asset.role === "video"), audios: references.filter((asset) => asset.role === "audio") }, preview.baseUrl, model.parameterOverrides);
                    assertSession(); setResult(checked); return;
                }
                const task = await testModelScript(script.id, { channelId: values.channelId, model, revision, prompt: values.prompt, parameters: values.parameters, references, confirmCharges: values.confirmCharges });
                assertSession(); form.reset(values); onQueued(task.id); onClose(); notify.success(t("modelScripts.testQueued"));
            } finally { setBusy(false); }
        }}>
            <Field name="channelId" label={t("workspace.channels")} schema={z.string().min(1)}><Choice disabled={Boolean(initial)} options={channels.data?.map((entry) => ({ value: entry.channel.id, label: entry.channel.name }))} /></Field>
            <div className="grid gap-3 sm:grid-cols-2"><Field name="model" label={t("workspace.providerModelId")} schema={z.string().trim().min(1)}><Input /></Field><Field name="name" label={t("workspace.displayName")}><Input /></Field></div>
            <Field name="prompt" label={t("modelScripts.testPrompt")} schema={z.string().trim().min(1)}><Textarea /></Field>
            <Field name="parameters"><ModelInputFields controls={controls} assetPrefix={false} onChange={() => undefined} /></Field>
            <Field name="references" label={t("modelScripts.referenceAssets")}><Choice multiple options={assets.filter((asset) => asset.kind !== "text" && asset.saveState === "saved").map((asset) => ({ label: asset.title, value: asset.id }))} /></Field>
            {!preview ? <Field name="confirmCharges" label={t("modelScripts.confirmCharges")} schema={z.boolean().refine(Boolean, t("modelScripts.confirmCharges"))} checked><Switch /></Field> : null}
        </EditorForm>
        {result ? <div className="mt-4 space-y-2"><p className="text-xs text-muted-foreground">{t("modelScripts.previewSnapshot")}</p><p className="break-all font-mono text-xs">{result.resolvedUrl}</p><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border p-3 text-xs">{JSON.stringify(result.request, null, 2)}</pre></div> : null}
    </Dialog>;
}
