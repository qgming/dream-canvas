import appI18n from "@/i18n";
import { PageHeader } from "@/components/layout/page-header";
import { useCallback } from "react";
import { useEditGuard } from "@/hooks/use-edit-guard";
import { Notice as Alert } from "@/components/ui/display";
import { useFeedback } from "@/hooks/use-feedback";
import { Button } from "@/components/ui/button";
import { EditorForm, Field } from "@/components/ui/form";
import { Choice } from "@/components/ui/choice";
import { Switch } from "@/components/ui/controls";
import { useTranslation } from "react-i18next";
import { RefreshCw, Save } from "lucide-react";

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
            <PageHeader stickyActions title={t("settings.preferences")} description={t("settings.preferencesDescription")} actions={<>
                <span role="status" className="text-xs text-muted-foreground">{saving ? appI18n.t("workspace.savePreferences") : dirty ? appI18n.t("workspace.unsaved") : hydrated ? appI18n.t("workspace.allSaved") : t("settings.loading")}</span>
                <Button variant="outline" icon={<RefreshCw />} disabled={saving} onClick={reload}>{appI18n.t("workspace.reload")}</Button>
                <Button variant="default" icon={<Save />} type="submit" form="preferences-form" disabled={!hydrated || !dirty || conflict} loading={saving}>{t("common.save")}</Button>
            </>} />
            {error ? <Alert type="error" title={error} action={<Button onClick={reload}>{appI18n.t("workspace.reload")}</Button>} /> : null}
            <EditorForm id="preferences-form" disabled={!hydrated || saving} className="space-y-8" onSubmit={() => useConfigStore.getState().save()}>
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
        </section>
    );
}

