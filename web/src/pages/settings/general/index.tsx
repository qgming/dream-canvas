import { Form, Segmented, Select } from "antd";
import { Moon, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";

import { changeAppLocale, type AppLocale } from "@/i18n";
import { useThemeStore } from "@/stores/use-theme-store";

export default function GeneralSettingsPage() {
    const { t, i18n } = useTranslation();
    const theme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);

    return (
        <section className="max-w-2xl">
            <h2 className="text-2xl font-medium tracking-tight">{t("settings.general")}</h2>
            <p className="mt-2 mb-8 text-sm leading-6 text-muted-foreground">{t("settings.generalDescription")}</p>
            <Form layout="vertical" requiredMark={false}>
                <Form.Item label={t("settings.language")} extra={t("settings.languageDescription")}>
                    <Select className="!w-full sm:!w-64" aria-label={t("settings.language")} value={i18n.resolvedLanguage as AppLocale} onChange={(value: AppLocale) => void changeAppLocale(value)} options={[{ value: "zh-CN", label: "简体中文" }, { value: "en-US", label: "English" }]} />
                </Form.Item>
                <Form.Item label={t("settings.appearance")} extra={t("settings.appearanceDescription")}>
                    <Segmented value={theme} onChange={setTheme} options={[
                        { value: "light", label: <span className="inline-flex items-center gap-2 px-2"><Sun className="size-4" />{t("settings.light")}</span> },
                        { value: "dark", label: <span className="inline-flex items-center gap-2 px-2"><Moon className="size-4" />{t("settings.dark")}</span> },
                    ]} />
                </Form.Item>
            </Form>
        </section>
    );
}
