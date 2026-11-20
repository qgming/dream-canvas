import { useCallback } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/display";
import { EditorForm, Field } from "@/components/ui/form";
import { Segmented, Switch } from "@/components/ui/controls";
import { Choice } from "@/components/ui/choice";
import { Moon, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ThemeToggler } from "@animate-ui/react/primitives/effects/theme-toggler";

import { changeAppLocale, type AppLocale } from "@/i18n";
import { useEditGuard } from "@/hooks/use-edit-guard";
import { useFeedback } from "@/hooks/use-feedback";
import { useConfigStore } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";

export default function GeneralSettingsPage() {
    const { t, i18n } = useTranslation();
    const { confirm } = useFeedback();
    const theme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    const config = useConfigStore((state) => state.config);
    const hydrated = useConfigStore((state) => state.hydrated);
    const error = useConfigStore((state) => state.error);
    const saving = useConfigStore((state) => state.saving);
    const dirty = useConfigStore((state) => state.dirty);
    const conflict = useConfigStore((state) => state.conflict);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const discard = useCallback(() => { void useConfigStore.getState().load(true); }, []);
    useEditGuard(dirty && Boolean(error) && !saving, discard);
    const reload = () => {
        const read = () => useConfigStore.getState().load(true);
        if (dirty) confirm({ title: t("workspace.discardPreferences"), content: t("workspace.reloadPreferences"), confirmText: t("workspace.discardAndReload"), cancelText: t("workspace.preserveEdits"), onConfirm: read });
        else void read();
    };

    return (
        <section className="space-y-6">
            <PageHeader title={t("settings.general")} />
            <div className="space-y-8">
                <EditorForm className="space-y-0">
                    <div>
                        <Field layout="horizontal" label={t("settings.language")}>
                            <Choice value={i18n.resolvedLanguage as AppLocale} onChange={(value: AppLocale) => void changeAppLocale(value)} options={[{ value: "zh-CN", label: "简体中文" }, { value: "en-US", label: "English" }]} />
                        </Field>
                        <Field layout="horizontal" label={t("settings.appearance")}>
                            <ThemeToggler theme={theme} resolvedTheme={theme} setTheme={(value) => { if (value !== "system") setTheme(value); }}>{({ toggleTheme }) => <Segmented className="w-full p-0.5" value={theme} onChange={(value) => { if (value !== theme) void toggleTheme(value); }} options={[
                                { value: "light", label: <span className="inline-flex items-center gap-2"><Sun className="size-4" />{t("settings.light")}</span> },
                                { value: "dark", label: <span className="inline-flex items-center gap-2"><Moon className="size-4" />{t("settings.dark")}</span> },
                            ]} />}</ThemeToggler>
                        </Field>
                    </div>
                </EditorForm>
                <section>
                    <h2 className="mb-2 text-base font-semibold">{t("settings.preferences")}</h2>
                    {error ? <Notice type={conflict ? "warning" : "error"} className="mb-4" title={error} action={<Button disabled={saving} onClick={() => { if (conflict || !dirty || !hydrated) reload(); else void useConfigStore.getState().save(); }}>{t(conflict ? "workspace.reload" : "workspace.retry")}</Button>} /> : null}
                    <EditorForm disabled={!hydrated || conflict} className="space-y-0">
                        <div>
                            <Field layout="horizontal" label={t("config.preferences.regenerateBehavior")} help={`${t("config.preferences.regenerateBehaviorOverwriteDescription")}\n${t("config.preferences.regenerateBehaviorNewNodeDescription")}`}>
                                <Choice value={config.nodeRegenerateBehavior} onChange={(value) => updateConfig("nodeRegenerateBehavior", value)} options={[{ value: "overwrite", label: t("settings.regenerateInPlace") }, { value: "new-node", label: t("settings.regenerateNewNode") }]} />
                            </Field>
                            <Field layout="horizontal" label={t("config.preferences.autoFocusOnSelect")} help={t("config.preferences.autoFocusOnSelectDescription")}>
                                <Switch checked={config.autoFocusOnSelect} onChange={(checked) => updateConfig("autoFocusOnSelect", checked)} />
                            </Field>
                        </div>
                    </EditorForm>
                </section>
            </div>
        </section>
    );
}
