import type { ReactNode } from "react";
import { useState } from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Popover, Tooltip } from "@/components/ui/popover";
import { Group, Hand, Image as ImageIcon, Images, LocateFixed, MousePointer2, Music2, Puzzle, Redo2, Settings2, Trash2, Type, Undo2, Upload, Video } from "lucide-react";

import { canvasThemes, type CanvasTheme } from "@/lib/canvas-theme";
import { isBuiltinNodeType, isRegisteredNodeType, listNodeDefinitions, useNodeRegistryVersion } from "@/lib/canvas/node-registry";
import { getNodeSpec } from "@/constant/canvas";
import { cn } from "@/lib/utils";
import { useThemeStore } from "@/stores/use-theme-store";
import { useTranslation } from "react-i18next";

export function CanvasToolbar({
    selectedCount,
    canvasTool,
    canUndo,
    canRedo,
    onAddImage,
    onAddVideo,
    onAddAudio,
    onAddText,
    onAddConfig,
    onAddGroup,
    onAddExtensionNode,
    onUndo,
    onRedo,
    onOpenAssetLibrary,
    onUpload,
    onDelete,
    onCanvasToolChange,
    onFocusSelected,
}: {
    selectedCount: number;
    canvasTool: "select" | "pan";
    canUndo: boolean;
    canRedo: boolean;
    onAddImage: () => void;
    onAddVideo: () => void;
    onAddAudio: () => void;
    onAddText: () => void;
    onAddConfig: () => void;
    onAddGroup: () => void;
    onAddExtensionNode: (type: string) => void;
    onUndo: () => void;
    onRedo: () => void;
    onOpenAssetLibrary: () => void;
    onUpload: () => void;
    onDelete: () => void;
    onCanvasToolChange: (tool: "select" | "pan") => void;
    onFocusSelected: () => void;
}) {
    const { t } = useTranslation();
    const colorTheme = useThemeStore((state) => state.theme);
    const theme = canvasThemes[colorTheme];
    const [extensionsOpen, setExtensionsOpen] = useState(false);
    useNodeRegistryVersion();
    const extensionDefs = listNodeDefinitions().filter((def) => def.showInCreateMenu !== false && !isBuiltinNodeType(def.type));
    const dockStyle = { background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.toolbar.item, boxShadow: "var(--shadow-lg)" };

    return (
        <div className="pointer-events-none absolute inset-y-20 left-4 z-50 flex items-center" data-ui-overlay data-canvas-no-zoom data-canvas-shortcuts-ignore onPointerDown={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
            <div role="toolbar" aria-label={t("canvas.toolbar.label")} aria-orientation="vertical" data-canvas-toolbar className="thin-scrollbar pointer-events-auto flex max-h-full w-fit flex-col items-center gap-1 overflow-x-hidden overflow-y-auto overscroll-contain rounded-xl border p-1 shadow-lg backdrop-blur [&>*]:shrink-0" style={dockStyle}>
                <ToolbarButton label={t(`canvas.toolbar.${canvasTool}`)} active onClick={() => onCanvasToolChange(canvasTool === "select" ? "pan" : "select")}>
                    {canvasTool === "select" ? <MousePointer2 className="size-4.5" /> : <Hand className="size-4.5" />}
                </ToolbarButton>
                <ToolbarButton label={t("canvas.undo")} disabled={!canUndo} onClick={onUndo}>
                    <Undo2 className="size-4.5" />
                </ToolbarButton>
                <ToolbarButton label={t("canvas.redo")} disabled={!canRedo} onClick={onRedo}>
                    <Redo2 className="size-4.5" />
                </ToolbarButton>
                <ToolbarButton label={t("canvas.toolbar.focus")} disabled={!selectedCount} onClick={onFocusSelected}>
                    <LocateFixed className="size-4.5" />
                </ToolbarButton>
                <Divider theme={theme} />
                {isRegisteredNodeType("text") ? <ToolbarButton label={t("canvas.toolbar.text")} onClick={onAddText}>
                    <Type className="size-4.5" />
                </ToolbarButton> : null}
                {isRegisteredNodeType("image") ? <ToolbarButton label={t("canvas.toolbar.image")} onClick={onAddImage}>
                    <ImageIcon className="size-4.5" />
                </ToolbarButton> : null}
                {isRegisteredNodeType("video") ? <ToolbarButton label={t("canvas.toolbar.video")} onClick={onAddVideo}>
                    <Video className="size-4.5" />
                </ToolbarButton> : null}
                {isRegisteredNodeType("audio") ? <ToolbarButton label={t("canvas.toolbar.audio")} onClick={onAddAudio}>
                    <Music2 className="size-4.5" />
                </ToolbarButton> : null}
                {isRegisteredNodeType("config") ? <ToolbarButton label={t("canvas.toolbar.config")} onClick={onAddConfig}>
                    <Settings2 className="size-4.5" />
                </ToolbarButton> : null}
                {isRegisteredNodeType("group") ? <ToolbarButton label={t("canvas.toolbar.group")} onClick={onAddGroup}>
                    <Group className="size-4.5" />
                </ToolbarButton> : null}
                {extensionDefs.length ? (
                    <Popover
                        trigger="click"
                        placement="right"
                        open={extensionsOpen}
                        onOpenChange={setExtensionsOpen}
                        className="thin-scrollbar w-60 p-2"
                        content={
                            <>
                                <div className="px-1.5 pb-1.5 text-xs font-medium text-muted-foreground">{t("canvas.toolbar.extensions")}</div>
                                <div className="grid gap-0.5">
                                    {extensionDefs.map((def) => (
                                        <Button
                                            key={def.type}
                                            variant="ghost"
                                            className="h-auto w-full justify-start gap-2.5 px-2 py-1.5 text-left"
                                            onClick={() => {
                                                onAddExtensionNode(def.type);
                                                setExtensionsOpen(false);
                                            }}
                                        >
                                            <span className="grid size-7 shrink-0 place-items-center [&_svg]:size-4 [&_svg]:shrink-0">{def.icon}</span>
                                            <span className="min-w-0 flex-1 truncate">{getNodeSpec(def.type).title}</span>
                                        </Button>
                                    ))}
                                </div>
                            </>
                        }
                    >
                        <ToolbarButton label={t("canvas.toolbar.extensions")} active={extensionsOpen}>
                            <Puzzle className="size-4.5" />
                        </ToolbarButton>
                    </Popover>
                ) : null}
                <ToolbarButton label={t("navigation.assets")} onClick={onOpenAssetLibrary}>
                    <Images className="size-4.5" />
                </ToolbarButton>
                <ToolbarButton label={t("canvas.toolbar.upload")} onClick={onUpload}>
                    <Upload className="size-4.5" />
                </ToolbarButton>
                {selectedCount ? (
                    <>
                        <Divider theme={theme} />
                        <ToolbarButton label={t("canvas.deleteSelected")} onClick={onDelete} danger>
                            <Trash2 className="size-4.5" />
                        </ToolbarButton>
                    </>
                ) : null}
            </div>
        </div>
    );
}

function ToolbarButton({
    label,
    active,
    danger = false,
    children,
    className,
    style,
    ...props
}: Omit<ButtonProps, "children"> & {
    label: string;
    active?: boolean;
    danger?: boolean;
    children: ReactNode;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    return (
        <Tooltip title={label} placement="right">
            <Button
                {...props}
                variant="ghost"
                size="icon"
                data-destructive={danger || undefined}
                aria-label={label}
                aria-pressed={active}
                className={cn("[&_svg]:size-4.5", className)}
                style={{ color: danger ? "var(--destructive)" : active ? theme.toolbar.activeText : theme.toolbar.item, background: active ? theme.toolbar.activeBg : undefined, ...style }}
                icon={children}
            />
        </Tooltip>
    );
}

function Divider({ theme }: { theme: CanvasTheme }) {
    return <div className="h-px w-6" style={{ background: theme.toolbar.border }} />;
}
