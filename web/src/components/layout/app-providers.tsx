import type { ReactNode } from "react";
import { useEffect, useLayoutEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Tooltip } from "radix-ui";
import { Toaster } from "sonner";
import dayjs from "dayjs";
import "dayjs/locale/zh-cn";
import { useTranslation } from "react-i18next";

import { ClientRootInit } from "@/components/layout/client-root-init";
import type { AppLocale } from "@/i18n";
import { applyAppTheme } from "@/lib/app-theme";
import { FeedbackProvider } from "@/hooks/use-feedback";
import { useThemeStore } from "@/stores/use-theme-store";

const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 30_000,
            retry: false,
            refetchOnWindowFocus: false,
        },
    },
});

export function AppProviders({ children }: { children: ReactNode }) {
    const { i18n, t } = useTranslation();
    const theme = useThemeStore((state) => state.theme);
    const dark = theme === "dark";
    const locale = i18n.resolvedLanguage as AppLocale;

    useLayoutEffect(() => applyAppTheme(theme), [theme]);

    useEffect(() => {
        document.documentElement.lang = locale;
        document.title = t("meta.title");
        document.querySelector('meta[name="description"]')?.setAttribute("content", t("meta.description"));
        dayjs.locale(locale === "zh-CN" ? "zh-cn" : "en");
    }, [locale, t]);

    return (
        <Tooltip.Provider>
            <FeedbackProvider>
                <QueryClientProvider client={queryClient}>
                    <ClientRootInit>{children}</ClientRootInit>
                </QueryClientProvider>
                <Toaster theme={dark ? "dark" : "light"} position="top-right" closeButton toastOptions={{ style: { background: "var(--popover)", color: "var(--foreground)", borderColor: "var(--border)", fontFamily: "var(--font-app)", fontSize: 14 } }} />
            </FeedbackProvider>
        </Tooltip.Provider>
    );
}
