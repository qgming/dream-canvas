import { useCallback, useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ThemeToggler, type ThemeSelection } from "@animate-ui/react/primitives/effects/theme-toggler";

import { Button, type ButtonProps } from "./button";

type ThemeMode = "light" | "dark";

interface AnimatedThemeTogglerProps extends ButtonProps {
    theme?: ThemeMode;
    targetTheme?: ThemeMode;
    onThemeChange?: (theme: ThemeMode) => void;
}

function documentTheme(): ThemeMode {
    return typeof document !== "undefined" && document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function systemTheme(): ThemeMode {
    return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export const AnimatedThemeToggler = ({ children, className, theme, targetTheme, onThemeChange, onClick, ...props }: AnimatedThemeTogglerProps) => {
    const { t } = useTranslation();
    const [resolvedTheme, setResolvedTheme] = useState<ThemeMode>(() => theme ?? documentTheme());

    useEffect(() => {
        if (theme) {
            setResolvedTheme(theme);
            return;
        }
        const update = () => setResolvedTheme(documentTheme());
        update();
        const observer = new MutationObserver(update);
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
        return () => observer.disconnect();
    }, [theme]);

    const setTheme = useCallback((next: ThemeSelection) => {
        const resolved = next === "system" ? systemTheme() : next;
        setResolvedTheme(resolved);
        document.documentElement.classList.toggle("dark", resolved === "dark");
        document.documentElement.style.colorScheme = resolved;
        onThemeChange?.(resolved);
    }, [onThemeChange]);

    return (
        <ThemeToggler theme={resolvedTheme} resolvedTheme={resolvedTheme} setTheme={setTheme}>
            {({ resolved, toggleTheme }) => (
                <Button
                    variant="ghost" size="icon"
                    className={className}
                    onClick={(event) => {
                        onClick?.(event);
                        if (event.defaultPrevented) return;
                        const next = targetTheme ?? (resolved === "dark" ? "light" : "dark");
                        if (next !== resolved) void toggleTheme(next);
                    }}
                    {...props}
                >
                    {children ?? (resolved === "dark" ? <Sun /> : <Moon />)}
                    <span className="sr-only">{props["aria-label"] || t("theme.toggle")}</span>
                </Button>
            )}
        </ThemeToggler>
    );
};
