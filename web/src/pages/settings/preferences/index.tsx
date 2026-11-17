import appI18n from "@/i18n";
import { PageHeader } from "@/components/layout/page-header";
import { useCallback, useState } from "react";
import { useEditGuard } from "@/hooks/use-edit-guard";
import { Notice as Alert } from "@/components/ui/display";
import { useFeedback } from "@/hooks/use-feedback";
import { Button } from "@/components/ui/button";
import { EditorForm, Field } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Choice } from "@/components/ui/choice";
import { Switch } from "@/components/ui/controls";
import { useTranslation } from "react-i18next";

import { ModelPicker } from "@/components/model-picker";
import { ModelParameters } from "@/components/model-parameters";
import { channelModelId, useConfigStore } from "@/stores/use-config-store";
import { useOpenModelSettings } from "@/hooks/use-open-model-settings";
import { captureSession } from "@/services/api/client";

const modelGroups = [
    { capability: "image", modelKey: "imageModel", labelKey: "config.preferences.defaultImageModel" },
    { capability: "video", modelKey: "videoModel", labelKey: "config.preferences.defaultVideoModel" },
    { capability: "text", modelKey: "textModel", labelKey: "config.preferences.defaultTextModel" },
    { capability: "audio", modelKey: "audioModel", labelKey: "config.preferences.defaultAudioModel" },
] as const;

export default function PreferencesPage() {
    const { notify, confirm } = useFeedback();
    const { t } = useTranslation();
    const openModelSettings = useOpenModelSettings();
    const config = useConfigStore((state) => state.config);
    const hydrated = useConfigStore((state) => state.hydrated);
    const error = useConfigStore((state) => state.error);
    const saving = useConfigStore((state) => state.saving);
    const dirty = useConfigStore((state) => state.dirty);
    const conflict = useConfigStore((state) => state.conflict);
    const discard = useCallback(() => { void useConfigStore.getState().load(true); }, []);
    useEditGuard(dirty, discard);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const [parameterModel, setParameterModel] = useState("");
    const selectedModel = parameterModel || config.imageModel || config.textModel || config.videoModel || config.audioModel;
    const selectedId = channelModelId(config, selectedModel);
    const reload = () => {
        const assertSession = captureSession();
        const read = async () => { try { assertSession(); await useConfigStore.getState().load(true); } catch (error) { notify.error(error instanceof Error ? error.message : appI18n.t("workspace.readFailed")); } };
        if (dirty) confirm({ title: appI18n.t("workspace.discardPreferences"), content: appI18n.t("workspace.reloadPreferences"), confirmText: appI18n.t("workspace.discardAndReload"), cancelText: appI18n.t("workspace.preserveEdits"), onConfirm: read });
        else void read();
    };
    return (
        <section className="space-y-6">
            <PageHeader title={t("settings.preferences")} description={t("settings.preferencesDescription")} />
            {error ? <Alert type="error" title={error} action={<Button onClick={reload}>{appI18n.t("workspace.reload")}</Button>} /> : null}
            <EditorForm disabled={!hydrated || saving} className="space-y-8">
                <section>
                    <h2 className="mb-2 text-base font-semibold">{t("config.preferences.defaultModels")}</h2>
                    <div>
                        {modelGroups.map((group) => (
                            <Field key={group.modelKey} layout="horizontal" label={t(group.labelKey)}>
                                <ModelPicker config={config} value={config[group.modelKey]} onChange={(model) => updateConfig(group.modelKey, model)} capability={group.capability} onMissingConfig={openModelSettings} fullWidth />
                            </Field>
                        ))}
                    </div>
                </section>
                <section>
                    <h2 className="mb-2 text-base font-semibold">{t("config.preferences.modelParameters")}</h2>
                    <p className="mb-3 text-xs leading-5 text-muted-foreground">{t("config.preferences.modelParametersDescription")}</p>
                    <Field layout="horizontal" label={t("workspace.channelModel")}>
                        <ModelPicker config={config} value={selectedModel} onChange={setParameterModel} onMissingConfig={openModelSettings} fullWidth />
                    </Field>
                    {selectedId ? <div className="mt-3 max-w-xl space-y-3">
                        <ModelParameters config={config} model={selectedModel} value={config.parameterDefaults[selectedId]} disabled={!hydrated || saving} defaultsOnly onChange={(value) => updateConfig("parameterDefaults", { ...config.parameterDefaults, [selectedId]: value })} />
                        <Button variant="ghost" disabled={!Object.keys(config.parameterDefaults[selectedId] || {}).length} onClick={() => { const next = { ...config.parameterDefaults }; delete next[selectedId]; updateConfig("parameterDefaults", next); }}>{t("config.preferences.resetParameters")}</Button>
                    </div> : null}
                </section>
                <section>
                    <h2 className="mb-2 text-base font-semibold">{t("config.preferences.generation")}</h2>
                    <div>
                        <Field layout="horizontal" label={t("config.preferences.canvasImageCount")} description={t("config.preferences.canvasImageCountDescription")}>
                            <Input
                                className="w-24 text-right tabular-nums"
                                type="number"
                                min={1}
                                max={15}
                                value={config.canvasImageCount}
                                onChange={(event) => updateConfig("canvasImageCount", event.target.value)}
                                onBlur={(event) => updateConfig("canvasImageCount", normalizeImageCount(event.target.value))}
                            />
                        </Field>
                    </div>
                </section>
                <section>
                    <h2 className="mb-2 text-base font-semibold">{t("settings.canvasInteraction")}</h2>
                    <div>
                        <Field layout="horizontal" label={t("config.preferences.regenerateBehavior")} description={t(config.nodeRegenerateBehavior === "overwrite" ? "config.preferences.regenerateBehaviorOverwriteDescription" : "config.preferences.regenerateBehaviorNewNodeDescription")}>
                            <Choice value={config.nodeRegenerateBehavior} onChange={(value) => updateConfig("nodeRegenerateBehavior", value)} options={[{ value: "overwrite", label: t("settings.regenerateInPlace") }, { value: "new-node", label: t("settings.regenerateNewNode") }]} />
                        </Field>
                        <Field layout="horizontal" label={t("config.preferences.autoFocusOnSelect")}>
                            <Switch checked={config.autoFocusOnSelect} onChange={(checked) => updateConfig("autoFocusOnSelect", checked)} />
                        </Field>
                    </div>
                </section>
            </EditorForm>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
                <span role="status" className="text-xs text-muted-foreground">{saving ? appI18n.t("workspace.savePreferences") : dirty ? appI18n.t("workspace.unsaved") : hydrated ? appI18n.t("workspace.allSaved") : t("settings.loading")}</span>
                <div className="ml-auto flex items-center gap-2">
                    <Button variant="ghost" disabled={saving} onClick={reload}>{appI18n.t("workspace.reload")}</Button>
                    <Button variant="default" disabled={!hydrated || !dirty || conflict} loading={saving} onClick={() => void useConfigStore.getState().save()}>{t("common.save")}</Button>
                </div>
            </div>
        </section>
    );
}

function normalizeImageCount(value: string) { return String(Math.max(1, Math.min(15, Math.floor(Math.abs(Number(value)) || 3)))); }
