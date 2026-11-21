import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ThemeName = "light" | "dark";
export type ThemeMode = ThemeName | "system";

const resolveTheme = (mode: ThemeMode): ThemeName => mode === "system" ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : mode;

type ThemeStore = {
    mode: ThemeMode;
    theme: ThemeName;
    setTheme: (mode: ThemeMode) => void;
};

export const useThemeStore = create<ThemeStore>()(
    persist(
        (set) => ({
            mode: "system",
            theme: resolveTheme("system"),
            setTheme: (mode) => set({ mode, theme: resolveTheme(mode) }),
        }),
        {
            name: "infinite-canvas:theme_store",
            partialize: (state) => ({ mode: state.mode }),
            merge: (persisted, current) => {
                const savedMode = (persisted as { mode?: ThemeMode } | undefined)?.mode;
                const mode = savedMode === "light" || savedMode === "dark" ? savedMode : "system";
                return { ...current, mode, theme: resolveTheme(mode) };
            },
        },
    ),
);
