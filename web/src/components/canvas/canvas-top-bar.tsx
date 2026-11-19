import { useState } from "react";
import { Check, Download, Images, Keyboard, Menu as MenuIcon, PanelLeftClose, PanelLeftOpen, Plus, Redo2, Trash2, Undo2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Menu } from "@/components/ui/popover";
import { Dialog } from "@/components/ui/dialog";
import { Tooltip } from "@/components/ui/popover";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { useCanvasPanelDisplay } from "@/hooks/use-canvas-panel-display";
import { useThemeStore } from "@/stores/use-theme-store";

export function CanvasTopBar({
    title,
    titleDraft,
    isTitleEditing,
    titleSaving,
    titleError,
    onTitleDraftChange,
    onStartTitleEditing,
    onFinishTitleEditing,
    onCancelTitleEditing,
    canUndo,
    canRedo,
    onProjects,
    onCreateProject,
    onDeleteProject,
    onExportProject,
    onImportImage,
    onUndo,
    onRedo,
}: {
    title: string;
    titleDraft: string;
    isTitleEditing: boolean;
    titleSaving: boolean;
    titleError: string;
    onTitleDraftChange: (value: string) => void;
    onStartTitleEditing: () => void;
    onFinishTitleEditing: () => void | Promise<void>;
    onCancelTitleEditing: () => void;
    canUndo: boolean;
    canRedo: boolean;
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
    const [shortcutsOpen, setShortcutsOpen] = useState(false);
    const { open: sidePanelOpen, toggle: toggleSidePanel } = useCanvasPanelDisplay();

    return (
        <>
            <div className="pointer-events-none absolute left-0 right-0 top-0 z-50 flex h-16 items-center justify-between gap-2 pl-1 pr-4">
                <div className="pointer-events-auto flex min-w-0 items-center gap-2">
                    <Tooltip title={sidePanelOpen ? t("canvas.collapsePanel") : t("canvas.expandPanel")}>
                        <Button
                            variant="ghost" size="icon"
                            onClick={toggleSidePanel}
                            aria-label={sidePanelOpen ? t("canvas.collapsePanel") : t("canvas.expandPanel")}
                            className="grid size-7 shrink-0 place-items-center rounded-md transition hover:bg-accent"
                            style={{ color: theme.node.text }}
                        >
                            {sidePanelOpen ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}
                        </Button>
                    </Tooltip>
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
                        {isTitleEditing ? (
                            <><input
                                autoFocus
                                disabled={titleSaving}
                                aria-label={t("canvas.project.rename")}
                                aria-invalid={Boolean(titleError)}
                                aria-describedby={titleError ? "canvas-title-error" : undefined}
                                value={titleDraft}
                                onChange={(event) => onTitleDraftChange(event.target.value)}
                                onKeyDown={(event) => {
                                    if (event.key === "Enter") { event.preventDefault(); void onFinishTitleEditing(); }
                                    if (event.key === "Escape") { event.stopPropagation(); onCancelTitleEditing(); }
                                }}
                                className="h-8 w-44 min-w-0 max-w-[280px] flex-1 rounded-md border border-input bg-transparent px-2 text-left text-lg font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                style={{ color: theme.node.text }}
                            /><Button variant="ghost" size="sm" loading={titleSaving} icon={<Check className="size-4" />} onClick={() => void onFinishTitleEditing()} aria-label={t("canvas.project.saveName")} /><Button variant="ghost" size="sm" disabled={titleSaving} icon={<X className="size-4" />} onClick={onCancelTitleEditing} aria-label={t("canvas.project.cancelRename")} />{titleError ? <p id="canvas-title-error" role="alert" className="absolute left-0 top-full mt-1 max-w-sm rounded-md border border-border bg-popover px-2 py-1 text-xs text-destructive">{titleError}</p> : null}</>
                        ) : (
                            <Tooltip title={t("canvas.renameHint")}><button
                                type="button"
                                className="min-w-0 max-w-[280px] truncate border-b border-dashed border-transparent text-left text-lg font-semibold tracking-normal transition hover:border-current"
                                onDoubleClick={onStartTitleEditing}
                                onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onStartTitleEditing(); } }}
                            >
                                {title}
                            </button></Tooltip>
                        )}
                    </div>
                    
                </div>

                <div className="pointer-events-auto flex shrink-0 items-center gap-1.5">
                    <Button variant="ghost" size="icon" className="size-7" style={{ color: theme.node.text }} onClick={() => setShortcutsOpen(true)} aria-label={t("topNav.shortcuts")} title={t("topNav.shortcuts")}><Keyboard className="size-4" /></Button>
                </div>
            </div>
            <Dialog title={t("canvas.shortcuts")} open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} footer={null}>
                <div className="space-y-2 border-t pt-4 text-sm" style={{ borderColor: theme.node.stroke }}>
                    <Shortcut keys={["Ctrl / Space", t("canvas.shortcut.drag")]} value={t("canvas.shortcut.toggleTool")} />
                    <Shortcut keys={[t("canvas.shortcut.wheel")]} value={t("canvas.shortcut.zoom")} />
                    <Shortcut keys={[t("canvas.shortcut.zoomSlider")]} value={t("canvas.shortcut.preciseZoom")} />
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
