import { useLayoutEffect, useRef, useState } from "react";
import { Check, Maximize2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { CanvasNodePanelProps } from "@dream-canvas/plugin-sdk";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { canvasThemes } from "@/lib/canvas-theme";
import { isImeComposing } from "@/lib/keyboard-event";
import { cn } from "@/lib/utils";
import { useThemeStore } from "@/stores/use-theme-store";

export function CanvasNodeContentEditor({ ctx, onClose }: CanvasNodePanelProps) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const format = ctx.node.type === "sticky-note:note" ? "note" : "text";
    const value = ctx.node.metadata?.content || "";
    const [expanded, setExpanded] = useState(false);
    const editorRef = useRef<HTMLTextAreaElement>(null);
    const expandedRef = useRef<HTMLTextAreaElement>(null);
    useLayoutEffect(() => {
        const editor = editorRef.current;
        if (!editor) return;
        const resize = () => { editor.style.height = "auto"; editor.style.height = `${editor.scrollHeight}px`; };
        resize();
        const observer = new ResizeObserver(resize);
        observer.observe(editor.parentElement!);
        return () => observer.disconnect();
    }, [value]);

    const renderInput = (large = false) => <div className="flex min-h-0 min-w-0">
        <textarea ref={large ? expandedRef : editorRef} autoFocus rows={3} value={value} spellCheck wrap="soft" aria-label={t("canvas.contentEditor.content")} placeholder={t(`canvas.contentEditor.placeholders.${format}`)}
            className={cn("thin-scrollbar min-w-0 flex-1 resize-none overflow-auto overscroll-contain rounded-lg border-0 bg-transparent p-0 text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/30", large ? "h-[52dvh] min-h-80" : "min-h-[3lh] max-h-[10lh]")}
            onChange={(event) => ctx.updateMetadata({ content: event.target.value })} onKeyDown={(event) => { event.stopPropagation(); if (event.key === "Escape" && !isImeComposing(event)) { event.preventDefault(); if (large) setExpanded(false); else onClose(); } }} />
    </div>;

    return <div data-ui-overlay data-canvas-no-zoom data-canvas-shortcuts-ignore className="flex max-h-[70dvh] min-h-0 flex-col gap-2 rounded-xl border p-3 shadow-lg backdrop-blur" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }} onPointerDown={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
        {renderInput()}
        <div className="flex shrink-0 items-center justify-between gap-1">
            <Button variant="ghost" size="icon" icon={<Maximize2 />} title={t("canvas.promptPanel.expandEditor")} aria-label={t("canvas.promptPanel.expandEditor")} onClick={() => setExpanded(true)} />
            <Button variant="default" size="icon" className="rounded-full" icon={<Check />} title={t("canvas.contentEditor.done")} aria-label={t("canvas.contentEditor.done")} onClick={onClose} />
        </div>
        <Dialog title={t("canvas.contentEditor.title", { name: ctx.node.title })} open={expanded} onClose={() => setExpanded(false)} width={760} footer={null}>{renderInput(true)}</Dialog>
    </div>;
}
