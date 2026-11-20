import { canvasThemes, type CanvasColorTheme } from "./canvas-theme";

export const appFont = '"SF Pro Text", -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';

export function themeVariables(mode: CanvasColorTheme): Record<string, string> {
    const theme = canvasThemes[mode];
    const dark = mode === "dark";
    return {
        "--background": theme.canvas.background, "--foreground": theme.node.text,
        "--card": theme.node.panel, "--card-foreground": theme.node.text,
        "--popover": theme.node.panel, "--popover-foreground": theme.node.text,
        "--primary": theme.node.activeStroke, "--primary-foreground": dark ? "#000000" : "#ffffff",
        "--secondary": theme.toolbar.itemHover, "--secondary-foreground": theme.node.text,
        "--muted": theme.toolbar.itemHover, "--muted-foreground": theme.node.label,
        "--accent": theme.toolbar.itemHover, "--accent-foreground": theme.node.text,
        "--overlay": dark ? "rgba(0,0,0,.65)" : "rgba(0,0,0,.25)",
        "--border": theme.node.stroke, "--input": theme.node.stroke, "--ring": theme.node.activeStroke,
        "--destructive": dark ? "#fca5a5" : "#b91c1c", "--destructive-foreground": dark ? "#450a0a" : "#fff7f7",
        "--success": dark ? "#86efac" : "#166534", "--warning": dark ? "#fcd34d" : "#854d0e", "--info": dark ? "#93c5fd" : "#1d4ed8",
        "--sidebar": theme.node.panel, "--sidebar-foreground": theme.node.text,
        "--sidebar-primary": theme.node.activeStroke, "--sidebar-primary-foreground": dark ? "#000000" : "#ffffff",
        "--sidebar-accent": theme.toolbar.activeBg, "--sidebar-accent-foreground": theme.node.text,
        "--sidebar-border": theme.node.stroke, "--sidebar-ring": theme.node.activeStroke,
        "--font-app": appFont,
    };
}

export function applyAppTheme(mode: CanvasColorTheme) {
    const root = document.documentElement;
    root.classList.toggle("dark", mode === "dark");
    root.style.colorScheme = mode;
    Object.entries(themeVariables(mode)).forEach(([name, value]) => root.style.setProperty(name, value));
}
