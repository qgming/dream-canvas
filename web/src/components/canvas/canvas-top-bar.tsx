import { useState } from "react";
import { CircleDot, Download, Grid2x2, Images, Info, Keyboard, Menu as MenuIcon, Palette, Plus, Redo2, Square, Trash2, Undo2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Segmented, Switch } from "@/components/ui/controls";
import { Menu, Popover, Tooltip } from "@/components/ui/popover";
import { Dialog } from "@/components/ui/dialog";
import { useTranslation } from "react-i18next";

import { canvasThemes, type CanvasBackgroundMode } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";

export function CanvasTopBar({
    title,
    onStartTitleEditing,
    canUndo,
    canRedo,
    backgroundMode,
    showParameterInfo,
    onBackgroundModeChange,
    onShowParameterInfoChange,
    onProjects,
    onCreateProject,
    onDeleteProject,
    onExportProject,
    onImportImage,
    onUndo,
    onRedo,
}: {
    title: string;
    onStartTitleEditing: () => void;
    canUndo: boolean;
    canRedo: boolean;
    backgroundMode: CanvasBackgroundMode;
    showParameterInfo: boolean;
    onBackgroundModeChange: (mode: CanvasBackgroundMode) => void;
    onShowParameterInfoChange: (show: boolean) => void;
    onProjects: () => void;
    onCreateProject: () => void;
    onDeleteProject: () => void;
    onExportProject: () => void;
    onImportImage: () => void;
    onUndo: () => void;
    onRedo: () => void;
}) {
    const colorTheme = useThemeStore((state) => state.theme);
    const { t } = useTranslation();
    const theme = canvasThemes[colorTheme];
    const [appearanceOpen, setAppearanceOpen] = useState(false);
    const [shortcutsOpen, setShortcutsOpen] = useState(false);

    return (
        <>
            <div className="pointer-events-none absolute left-0 right-0 top-0 z-50 flex h-16 items-center justify-between gap-2 pl-1 pr-4">
                <div className="pointer-events-auto flex min-w-0 items-center gap-2">
                    <Menu
                        items={ [
                                { key: "projects", icon: <Images className="size-4" />, label: t("canvas.projects"), onClick: onProjects },
                                { type: "divider" },
                                { key: "new", icon: <Plus className="size-4" />, label: t("canvas.create"), onClick: onCreateProject },
                                { key: "delete", danger: true, icon: <Trash2 className="size-4" />, label: t("canvas.deleteCurrent"), onClick: onDeleteProject },
                                { type: "divider" },
                                { key: "import", icon: <Upload className="size-4" />, label: t("canvas.importAsset"), onClick: onImportImage },
                                { key: "export", icon: <Download className="size-4" />, label: t("canvas.exportCurrent"), onClick: onExportProject },
                                { type: "divider" },
                                { key: "undo", disabled: !canUndo, icon: <Undo2 className="size-4" />, label: <MenuLabel text={t("canvas.undo")} shortcut="⌘ Z" />, onClick: onUndo },
                                { key: "redo", disabled: !canRedo, icon: <Redo2 className="size-4" />, label: <MenuLabel text={t("canvas.redo")} shortcut="⌘ ⇧ Z / ⌘ Y" />, onClick: onRedo },
                            ]
                        }>
                        <Button variant="ghost" size="icon" className="size-7" style={{ color: theme.node.text }} aria-label={t("canvas.openMenu")}>
                            <MenuIcon className="size-4" />
                        </Button>
                    </Menu>

                    <div className="relative flex min-w-0 items-center gap-2" data-canvas-shortcuts-ignore>
                        <Tooltip title={t("canvas.renameHint")}><button
                            type="button"
                            className="min-w-0 max-w-[280px] truncate border-b border-dashed border-transparent text-left text-lg font-semibold tracking-normal transition hover:border-current"
                            onDoubleClick={onStartTitleEditing}
                            onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onStartTitleEditing(); } }}
                        >
                            {title}
                        </button></Tooltip>
                    </div>
                    
                </div>

                <div className="pointer-events-auto flex shrink-0 items-center gap-1.5" data-ui-overlay data-canvas-no-zoom data-canvas-shortcuts-ignore onPointerDown={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
                    <Popover
                        trigger="click"
                        placement="bottomRight"
                        open={appearanceOpen}
                        onOpenChange={setAppearanceOpen}
                        className="thin-scrollbar w-[248px] p-2.5"
                        content={
                            <>
                                <div className="px-1 pb-2 text-sm font-medium">{t("canvas.toolbar.appearance")}</div>
                                <div className="px-1 pb-1.5 text-xs font-medium text-muted-foreground">{t("canvas.toolbar.gridStyle")}</div>
                                <Segmented
                                    className="w-full !p-1"
                                    aria-label={t("canvas.toolbar.gridStyle")}
                                    value={backgroundMode}
                                    onChange={(value) => onBackgroundModeChange(value as CanvasBackgroundMode)}
                                    options={[
                                        { value: "dots", label: <span className="inline-flex items-center gap-1.5"><CircleDot className="size-4" />{t("canvas.toolbar.dots")}</span> },
                                        { value: "lines", label: <span className="inline-flex items-center gap-1.5"><Grid2x2 className="size-4" />{t("canvas.toolbar.lines")}</span> },
                                        { value: "blank", label: <span className="inline-flex items-center gap-1.5"><Square className="size-4" />{t("canvas.toolbar.blank")}</span> },
                                    ]}
                                />
                                <div className="mt-3 flex items-center justify-between gap-3 rounded-lg px-1.5 py-1">
                                    <span className="inline-flex min-w-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
                                        <Info className="size-3.5" />{t("canvas.toolbar.parameterInfo")}
                                    </span>
                                    <Switch size="small" aria-label={t("canvas.toolbar.parameterInfo")} checked={showParameterInfo} onChange={onShowParameterInfoChange} />
                                </div>
                            </>
                        }
                    >
                        <Button variant="ghost" size="icon" className="size-7 data-[state=open]:bg-accent" style={{ color: theme.node.text }} icon={<Palette className="size-4" />} aria-label={t("canvas.toolbar.appearance")} title={t("canvas.toolbar.appearance")} />
                    </Popover>
                    <Button variant="ghost" size="icon" className="size-7" style={{ color: theme.node.text }} onClick={() => { setAppearanceOpen(false); setShortcutsOpen(true); }} aria-label={t("topNav.shortcuts")} title={t("topNav.shortcuts")}><Keyboard className="size-4" /></Button>
                </div>
            </div>
            <Dialog title={t("canvas.shortcuts")} open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} footer={null}>
                <div className="space-y-2 text-sm">
                    <Shortcut keys={["Ctrl / Space", t("canvas.shortcut.drag")]} value={t("canvas.shortcut.toggleTool")} />
                    <Shortcut keys={[t("canvas.shortcut.wheel")]} value={t("canvas.shortcut.zoom")} />
                    <Shortcut keys={[t("canvas.shortcut.zoomControl")]} value={t("canvas.shortcut.preciseZoom")} />
                    <Shortcut keys={[t("canvas.shortcut.drag")]} value={t("canvas.shortcut.boxSelect")} />
                    <Shortcut keys={[t("canvas.shortcut.rightClick")]} value={t("canvas.shortcut.addNode")} />
                    <Shortcut keys={["Shift / Cmd", t("canvas.shortcut.click")]} value={t("canvas.shortcut.addSelection")} />
                    <Shortcut keys={["Ctrl / Cmd", "A"]} value={t("canvas.shortcut.selectAll")} />
                    <Shortcut keys={["Ctrl / Cmd", "C / V"]} value={t("canvas.shortcut.copyPaste")} />
                    <Shortcut keys={["Ctrl / Cmd", "G"]} value={t("canvas.shortcut.group")} />
                    <Shortcut keys={["Ctrl / Cmd", "Shift", "G"]} value={t("canvas.shortcut.ungroup")} />
                    <Shortcut keys={["Ctrl / Cmd", "Z"]} value={t("canvas.undo")} />
                    <Shortcut keys={["Ctrl / Cmd", "Shift", "Z"]} value={t("canvas.redo")} />
                    <Shortcut keys={["Ctrl / Cmd", "Y"]} value={t("canvas.redo")} />
                    <Shortcut keys={["Delete / Backspace"]} value={t("canvas.shortcut.delete")} />
                    <Shortcut keys={["Esc"]} value={t("canvas.shortcut.escape")} />
                    <Shortcut keys={[t("canvas.shortcut.dropMedia")]} value={t("canvas.shortcut.upload")} />
                </div>
            </Dialog>
        </>
    );
}

function MenuLabel({ text, shortcut }: { text: string; shortcut: string }) {
    return (
        <span className="flex min-w-36 items-center justify-between gap-8">
            <span>{text}</span>
            <span className="text-xs opacity-45">{shortcut}</span>
        </span>
    );
}

function Shortcut({ keys, value }: { keys: string[]; value: string }) {
    return (
        <div className="grid grid-cols-[minmax(0,1fr)_120px] items-center gap-6 rounded-lg px-1 py-1.5">
            <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                {keys.map((key, index) => (
                    <span key={`${key}-${index}`} className="flex items-center gap-1.5">
                        {index ? <span className="text-xs opacity-35">+</span> : null}
                        <kbd
                            className="min-w-9 rounded-md border px-2.5 py-1.5 text-center text-xs font-medium leading-none shadow-[inset_0_-1px_0_rgba(0,0,0,.08),0_1px_2px_rgba(0,0,0,.06)]"
                            style={{ borderColor: "var(--border)", background: "var(--muted)", color: "var(--foreground)" }}
                        >
                            {key}
                        </kbd>
                    </span>
                ))}
            </span>
            <span className="text-right text-sm opacity-55">{value}</span>
        </div>
    );
}
