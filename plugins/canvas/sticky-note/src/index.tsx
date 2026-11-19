// 不再声明 resource(避免宿主在右上角显示「文本N」资源角标),也不再衍生节点。
import { definePlugin } from "@dream-canvas/plugin-sdk";
import type { CanvasNodeContentProps } from "@dream-canvas/plugin-sdk";
import { useTranslation } from "react-i18next";
import { StickyNote } from "lucide-react";
import { CanvasNodeContentEditor, canvasContentEditorToolbar } from "../../../../web/src/components/canvas/canvas-node-content-editor";
import { canvasThemes } from "../../../../web/src/lib/canvas-theme";
import { STICKY_NOTE_COLORS } from "../../../../web/src/lib/canvas/sticky-note-colors";

function StickyNoteContent({ ctx }: CanvasNodeContentProps) {
    const { t } = useTranslation();
    const color = typeof ctx.node.metadata?.pluginColor === "string" ? ctx.node.metadata.pluginColor : STICKY_NOTE_COLORS[0];
    const content = (ctx.node.metadata?.content as string | undefined) || "";

    return <div className="size-full select-none overflow-hidden whitespace-pre-wrap break-words rounded-xl p-4 text-sm leading-6" style={{ background: color, color: canvasThemes.light.node.text }}>
        {content || <span className="opacity-55">{t("canvas.contentEditor.empty", { name: t("canvas.contentEditor.formats.note") })}</span>}
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
            toolbar: canvasContentEditorToolbar,
            onDoubleClick: (ctx) => { ctx.openPanel(); return true; },
        },
    ],
});
