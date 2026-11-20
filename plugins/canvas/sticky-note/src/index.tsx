// 不再声明 resource(避免宿主在右上角显示「文本N」资源角标),也不再衍生节点。
import { definePlugin } from "@dream-canvas/plugin-sdk";
import type { CanvasNodeContentProps, CanvasNodeContext } from "@dream-canvas/plugin-sdk";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Palette, StickyNote } from "lucide-react";
import i18n from "../../../../web/src/i18n";
import { Button } from "../../../../web/src/components/ui/button";
import { Input } from "../../../../web/src/components/ui/input";
import { CanvasNodeContentEditor } from "../../../../web/src/components/canvas/canvas-node-content-editor";
import { canvasThemes } from "../../../../web/src/lib/canvas-theme";
import { STICKY_NOTE_COLORS } from "../../../../web/src/lib/canvas/sticky-note-colors";

function StickyNoteContent({ ctx }: CanvasNodeContentProps) {
    const { t } = useTranslation();
    const color = typeof ctx.node.metadata?.pluginColor === "string" ? ctx.node.metadata.pluginColor : STICKY_NOTE_COLORS[0];
    const content = (ctx.node.metadata?.content as string | undefined) || "";

    return <div className="size-full select-none overflow-hidden whitespace-pre-wrap break-words rounded-xl p-3 text-sm leading-6" style={{ background: color, color: canvasThemes.light.node.text }}>
        {content || <span className="opacity-55">{t("canvas.contentEditor.empty", { name: t("canvas.contentEditor.formats.note") })}</span>}
    </div>;
}

function StickyNoteColors({ ctx }: { ctx: CanvasNodeContext }) {
    const { t } = useTranslation();
    const committedColor = typeof ctx.node.metadata?.pluginColor === "string" ? ctx.node.metadata.pluginColor : STICKY_NOTE_COLORS[0];
    const [draftColor, setDraftColor] = useState(committedColor);
    const colorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pendingColor = useRef<(() => void) | null>(null);
    useEffect(() => { setDraftColor(committedColor); }, [committedColor]);
    useEffect(() => () => { if (colorTimer.current) clearTimeout(colorTimer.current); pendingColor.current?.(); }, []);
    const changeColor = (color: string, immediate = false) => {
        setDraftColor(color);
        if (colorTimer.current) clearTimeout(colorTimer.current);
        const commit = () => { colorTimer.current = null; pendingColor.current = null; ctx.updateMetadata({ pluginColor: color }); };
        pendingColor.current = commit;
        if (immediate) commit();
        else colorTimer.current = setTimeout(commit, 150);
    };
    return <div className="space-y-2" onPointerDown={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
        <div className="grid grid-cols-4 gap-1.5">{STICKY_NOTE_COLORS.map((color) => <Button key={color} variant="ghost" size="icon" className="rounded-full" style={{ backgroundColor: color }} aria-pressed={draftColor === color} aria-label={t("canvas.contentEditor.chooseColor", { color })} title={t("canvas.contentEditor.chooseColor", { color })} onClick={() => changeColor(color, true)}>{draftColor === color ? <Check className="text-white mix-blend-difference" /> : null}</Button>)}</div>
        <label className="flex items-center justify-between gap-2 text-xs">{t("canvas.contentEditor.customColor")}<Input type="color" className="w-16 cursor-pointer p-1" value={draftColor} aria-label={t("canvas.contentEditor.customColor")} onChange={(event) => changeColor(event.target.value)} onBlur={(event) => changeColor(event.target.value, true)} /></label>
    </div>;
}

export default definePlugin({
    id: "sticky-note",
    name: "便利贴节点",
    version: "1.1.0",
    description: "可自选颜色、双击编辑、拖动即可移动的便利贴",
    nodes: [
        {
            type: "sticky-note:note",
            title: "便利贴",
            icon: <StickyNote className="size-4" />,
            description: "彩色便利贴",
            defaultSize: { width: 240, height: 200 },
            defaultMetadata: { content: "", pluginColor: STICKY_NOTE_COLORS[0] },
            minimapColor: "#f59e0b",
            autoOpenPanel: true,
            Content: StickyNoteContent,
            Panel: CanvasNodeContentEditor,
            toolbar: (ctx) => [
                { id: "note-color", title: i18n.t("canvas.contentEditor.color"), label: i18n.t("canvas.contentEditor.color"), icon: <Palette className="size-4" />, popover: <StickyNoteColors key={ctx.node.id} ctx={ctx} /> },
            ],
            onDoubleClick: (ctx) => { ctx.openPanel(); return true; },
        },
    ],
});
