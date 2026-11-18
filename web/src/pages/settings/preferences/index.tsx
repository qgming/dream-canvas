import appI18n from "@/i18n";
import { PageHeader } from "@/components/layout/page-header";
import { useCallback } from "react";
import { useEditGuard } from "@/hooks/use-edit-guard";
import { Notice as Alert } from "@/components/ui/display";
import { useFeedback } from "@/hooks/use-feedback";
import { Button } from "@/components/ui/button";
import { EditorForm, Field } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Choice } from "@/components/ui/choice";
import { Switch } from "@/components/ui/controls";
import { useTranslation } from "react-i18next";

import { useConfigStore } from "@/stores/use-config-store";
import { captureSession } from "@/services/api/client";

export default function PreferencesPage() {
    const { notify, confirm } = useFeedback();
    const { t } = useTranslation();
    const config = useConfigStore((state) => state.config);
    const hydrated = useConfigStore((state) => state.hydrated);
    const error = useConfigStore((state) => state.error);
    const saving = useConfigStore((state) => state.saving);
    const dirty = useConfigStore((state) => state.dirty);
    const conflict = useConfigStore((state) => state.conflict);
    const discard = useCallback(() => { void useConfigStore.getState().load(true); }, []);
    useEditGuard(dirty, discard);
    const updateConfig = useConfigStore((state) => state.updateConfig);
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
