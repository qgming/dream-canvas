import { PageHeader } from "@/components/layout/page-header";
import { EditorForm, Field } from "@/components/ui/form";
import { Segmented } from "@/components/ui/controls";
import { Choice } from "@/components/ui/choice";
import { Moon, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ThemeToggler } from "@animate-ui/react/primitives/effects/theme-toggler";

import { changeAppLocale, type AppLocale } from "@/i18n";
import { useThemeStore } from "@/stores/use-theme-store";

export default function GeneralSettingsPage() {
    const { t, i18n } = useTranslation();
    const theme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);

    return (
        <section className="space-y-6">
            <PageHeader title={t("settings.general")} description={t("settings.generalDescription")} />
            <EditorForm className="space-y-0">
                <div>
                    <Field layout="horizontal" label={t("settings.language")} description={t("settings.languageDescription")}>
                        <Choice value={i18n.resolvedLanguage as AppLocale} onChange={(value: AppLocale) => void changeAppLocale(value)} options={[{ value: "zh-CN", label: "简体中文" }, { value: "en-US", label: "English" }]} />
                    </Field>
                    <Field layout="horizontal" label={t("settings.appearance")} description={t("settings.appearanceDescription")}>
                        <ThemeToggler theme={theme} resolvedTheme={theme} setTheme={(value) => { if (value !== "system") setTheme(value); }}>{({ toggleTheme }) => <Segmented className="w-full p-0.5" value={theme} onChange={(value) => { if (value !== theme) void toggleTheme(value); }} options={[
                            { value: "light", label: <span className="inline-flex items-center gap-2"><Sun className="size-4" />{t("settings.light")}</span> },
                            { value: "dark", label: <span className="inline-flex items-center gap-2"><Moon className="size-4" />{t("settings.dark")}</span> },
                        ]} />}</ThemeToggler>
                    </Field>
                </div>
            </EditorForm>
        </section>
    );
}
