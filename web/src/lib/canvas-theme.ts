export type CanvasColorTheme = "light" | "dark";
export type CanvasBackgroundMode = "dots" | "lines" | "blank";

export const canvasThemes = {
    light: {
        canvas: {
            background: "#f5f5f5",
            dot: "rgba(0,0,0,.18)",
            line: "rgba(0,0,0,.08)",
            selectionStroke: "#000000",
            selectionFill: "rgba(0,0,0,.06)",
        },
        node: {
            label: "#666666",
            fill: "#ffffff",
            panel: "#ffffff",
            stroke: "#e5e5e5",
            activeStroke: "#000000",
            placeholder: "#737373",
            text: "#000000",
            muted: "#737373",
            faint: "#a3a3a3",
        },
        toolbar: {
            panel: "#ffffff",
            border: "#e5e5e5",
            item: "#000000",
            itemHover: "#f0f0f0",
            activeBg: "#e8e8e8",
            activeText: "#000000",
        },
    },
    dark: {
        canvas: {
            background: "#000000",
            dot: "rgba(255,255,255,.20)",
            line: "rgba(255,255,255,.09)",
            selectionStroke: "#ffffff",
            selectionFill: "rgba(255,255,255,.10)",
        },
        node: {
            label: "#b5b5ba",
            fill: "#202022",
            panel: "#202022",
            stroke: "#363638",
            activeStroke: "#ffffff",
            placeholder: "#a1a1aa",
            text: "#ffffff",
            muted: "#a1a1aa",
            faint: "#71717a",
        },
        toolbar: {
            panel: "#202022",
            border: "#363638",
            item: "#ffffff",
            itemHover: "#2c2c2f",
            activeBg: "#363639",
            activeText: "#ffffff",
        },
    },
} as const;

export type CanvasTheme = (typeof canvasThemes)[CanvasColorTheme];
