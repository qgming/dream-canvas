import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, FileCode2, FileText, Maximize2, Palette, Pencil, StickyNote } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { CanvasNodeContext, CanvasNodePanelProps } from "@dream-canvas/plugin-sdk";
import i18n from "@/i18n";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Popover } from "@/components/ui/popover";
import { canvasThemes } from "@/lib/canvas-theme";
import { getGroupResourceNodes, resourceKind } from "@/lib/canvas/canvas-resource-references";
import { STICKY_NOTE_COLORS } from "@/lib/canvas/sticky-note-colors";
import { isImeComposing } from "@/lib/keyboard-event";
import { cn } from "@/lib/utils";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeReferenceBar } from "./canvas-node-reference-bar";
import { CanvasPromptLibrary } from "./canvas-prompt-library";

export function canvasContentEditorToolbar(ctx: CanvasNodeContext) {
    return [{ id: "edit-content", title: i18n.t("canvas.contentEditor.edit"), label: i18n.t("canvas.contentEditor.edit"), icon: <Pencil className="size-4" />, onClick: () => ctx.openPanel() }];
}

export function CanvasNodeContentEditor({ ctx, onClose }: CanvasNodePanelProps) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const format = ctx.node.type === "sticky-note:note" ? "note" : ctx.node.type.split(":")[0];
    const code = ["markdown", "html", "svg"].includes(format);
    const Icon = format === "note" ? StickyNote : code ? FileCode2 : FileText;
    const value = ctx.node.metadata?.content || "";
    const [expanded, setExpanded] = useState(false);
    const editorRef = useRef<HTMLTextAreaElement>(null);
    const expandedRef = useRef<HTMLTextAreaElement>(null);
    const gutterRef = useRef<HTMLDivElement>(null);
    const expandedGutterRef = useRef<HTMLDivElement>(null);
    const colorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const committedColor = typeof ctx.node.metadata?.pluginColor === "string" ? ctx.node.metadata.pluginColor : STICKY_NOTE_COLORS[0];
    const [draftColor, setDraftColor] = useState(committedColor);
    const entries = ctx.getUpstream().flatMap((source) => (source.type === "group" ? getGroupResourceNodes(source.id, ctx.getNodes()) : [source]).filter((node) => resourceKind(node) === "text").map((node) => ({ node, sourceNodeId: source.id })));

    useEffect(() => { setDraftColor(committedColor); }, [committedColor]);
    useEffect(() => () => { if (colorTimer.current) clearTimeout(colorTimer.current); }, []);
    useLayoutEffect(() => {
        const editor = editorRef.current;
        if (!editor) return;
        const resize = () => { editor.style.height = "auto"; editor.style.height = `${editor.scrollHeight}px`; if (gutterRef.current) gutterRef.current.scrollTop = editor.scrollTop; };
        resize();
        const observer = new ResizeObserver(resize);
        observer.observe(editor.parentElement!);
        return () => observer.disconnect();
    }, [value]);

    const changeColor = (color: string, immediate = false) => {
        setDraftColor(color);
        if (colorTimer.current) clearTimeout(colorTimer.current);
        if (immediate) { colorTimer.current = null; ctx.updateMetadata({ pluginColor: color }); }
        else colorTimer.current = setTimeout(() => { colorTimer.current = null; ctx.updateMetadata({ pluginColor: color }); }, 150);
    };
    const finish = () => { if (format === "note" && colorTimer.current) changeColor(draftColor, true); onClose(); };
    const insertSnippet = (snippet: string) => {
        const editor = expanded ? expandedRef.current : editorRef.current;
        const start = editor?.selectionStart ?? value.length, end = editor?.selectionEnd ?? value.length;
        ctx.updateMetadata({ content: value.slice(0, start) + snippet + value.slice(end) });
        requestAnimationFrame(() => { editor?.focus(); editor?.setSelectionRange(start + snippet.length, start + snippet.length); });
    };
    const renderInput = (large = false) => <div className="flex min-h-0 min-w-0 gap-3">
        {code ? <div ref={large ? expandedGutterRef : gutterRef} aria-hidden className={cn("thin-scrollbar shrink-0 select-none overflow-hidden text-right font-mono text-sm leading-6 text-muted-foreground/60", large ? "h-[52dvh] min-h-80" : "max-h-60")}>
            {value.split("\n").map((_, index) => <div key={index}>{index + 1}</div>)}
        </div> : null}
        <textarea ref={large ? expandedRef : editorRef} autoFocus rows={3} value={value} spellCheck={!code} wrap={code ? "off" : "soft"} aria-label={t("canvas.contentEditor.content")} placeholder={t(`canvas.contentEditor.placeholders.${format}`, { input: "{{input}}" })}
            className={cn("thin-scrollbar min-w-0 flex-1 resize-none overflow-auto overscroll-contain rounded-lg border-0 bg-transparent p-0 text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/30", code && "font-mono", large ? "h-[52dvh] min-h-80" : "min-h-[3lh] max-h-[10lh]")}
            onChange={(event) => ctx.updateMetadata({ content: event.target.value })} onScroll={(event) => { const gutter = large ? expandedGutterRef.current : gutterRef.current; if (gutter) gutter.scrollTop = event.currentTarget.scrollTop; }} onKeyDown={(event) => { event.stopPropagation(); if (event.key === "Escape" && !isImeComposing(event)) { event.preventDefault(); if (large) setExpanded(false); else finish(); } }} />
    </div>;

    return <div data-ui-overlay data-canvas-no-zoom data-canvas-shortcuts-ignore className="flex max-h-[70dvh] min-h-0 flex-col rounded-xl border p-4 shadow-lg backdrop-blur" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }} onPointerDown={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
        <div className="mb-3 flex min-w-0 shrink-0 items-start gap-2">
            {entries.length ? <CanvasNodeReferenceBar nodeId={ctx.node.id} entries={entries} square /> : <span className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-xs text-muted-foreground"><Icon className="size-4 shrink-0" />{t(`canvas.contentEditor.formats.${format}`)}</span>}
            <div className="ml-auto flex shrink-0 items-center gap-1"><CanvasPromptLibrary type="text" onSelect={insertSnippet} /><Button variant="ghost" size="icon" className="size-7 [&_svg]:size-3.5" icon={<Maximize2 />} title={t("canvas.promptPanel.expandEditor")} aria-label={t("canvas.promptPanel.expandEditor")} onClick={() => setExpanded(true)} /></div>
        </div>
        {renderInput()}
        <div className="mt-3 flex shrink-0 items-center gap-2">
            {format === "note" ? <Popover trigger="click" placement="topLeft" className="w-56" content={<div className="space-y-3"><div className="grid grid-cols-4 gap-2">{STICKY_NOTE_COLORS.map((color) => <Button key={color} variant="ghost" size="icon" className="size-8 rounded-full" style={{ backgroundColor: color }} aria-pressed={draftColor === color} aria-label={t("canvas.contentEditor.chooseColor", { color })} title={t("canvas.contentEditor.chooseColor", { color })} onClick={() => changeColor(color, true)}>{draftColor === color ? <Check className="text-primary-foreground mix-blend-difference" /> : null}</Button>)}</div><label className="flex items-center justify-between gap-3 text-xs">{t("canvas.contentEditor.customColor")}<Input type="color" className="w-16 cursor-pointer p-1" value={draftColor} aria-label={t("canvas.contentEditor.customColor")} onChange={(event) => changeColor(event.target.value)} onBlur={(event) => changeColor(event.target.value, true)} /></label></div>}><Button variant="ghost" size="icon" icon={<Palette />} title={t("canvas.contentEditor.color")} aria-label={t("canvas.contentEditor.color")} /></Popover> : null}
            <span className="text-xs text-muted-foreground">{t("canvas.contentEditor.lines", { count: value.split("\n").length })}</span>
            <Button variant="default" size="icon" className="ml-auto rounded-full" icon={<Check />} title={t("canvas.contentEditor.done")} aria-label={t("canvas.contentEditor.done")} onClick={finish} />
        </div>
        <Dialog title={t("canvas.contentEditor.title", { name: ctx.node.title })} open={expanded} onClose={() => setExpanded(false)} width={760} footer={null}><div data-canvas-no-zoom className="space-y-3" onWheel={(event) => event.stopPropagation()}>{entries.length ? <CanvasNodeReferenceBar nodeId={ctx.node.id} entries={entries} square /> : null}{renderInput(true)}</div></Dialog>
    </div>;
}
