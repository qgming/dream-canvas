// HTML 节点:沙箱 iframe 渲染 HTML,{{input}} 会替换为上游文本节点内容。
// 交互:预览态 iframe 默认 pointer-events:none —— 鼠标事件穿透到宿主节点体,
// 因此点节点任意位置都能拖动,无需在节点上加任何标题栏/按钮。
import { definePlugin, useMemo } from "@dream-canvas/plugin-sdk";
import type { CanvasNodeContentProps } from "@dream-canvas/plugin-sdk";
import { useTranslation } from "react-i18next";
import { Code2 } from "lucide-react";
import { CanvasNodeContentEditor, canvasContentEditorToolbar } from "../../../../web/src/components/canvas/canvas-node-content-editor";
import { canvasThemes } from "../../../../web/src/lib/canvas-theme";

function HtmlContent({ ctx }: CanvasNodeContentProps) {
    const { t } = useTranslation();
    const value = ctx.node.metadata?.content || "";
    const upstreamText = useMemo(
        () =>
            ctx
                .getUpstream()
                .map((node) => node.metadata?.content)
                .filter(Boolean)
                .join("\n"),
        [ctx],
    );
    const html = value.replace(/\{\{\s*input\s*\}\}/g, upstreamText);

    if (!value) {
        return (
            <div className="flex size-full flex-col items-center justify-center gap-2 p-4 text-center text-sm text-muted-foreground">
                <Code2 className="size-6" />
                <span>{t("canvas.contentEditor.empty", { name: "HTML" })}</span>
            </div>
        );
    }

    // 预览态:iframe 的鼠标交互由宿主「交互 ⇄ 移动」开关统一控制(见 interactionToggle),
    // 这里无需再手动做 pointer-events 穿透。data-canvas-no-zoom 保证交互时滚动作用于页面而非缩放画布。
    return (
        <div data-canvas-no-zoom style={{ position: "relative", height: "100%", width: "100%" }}>
            <iframe
                title="html-preview"
                sandbox="allow-scripts allow-forms"
                srcDoc={html}
                className="block size-full rounded-xl border-0"
                style={{ background: canvasThemes.light.node.panel }}
            />
        </div>
    );
}

export default definePlugin({
    id: "html",
    name: "HTML 节点",
    version: "1.2.0",
    description: "沙箱 iframe 渲染 HTML,支持 {{input}} 注入上游文本",
    nodes: [
        {
            type: "html:render",
            title: "HTML",
            icon: <Code2 className="size-4" />,
            description: "沙箱渲染 HTML",
            defaultSize: { width: 420, height: 320 },
            defaultMetadata: { content: "" },
            minimapColor: "#ec4899",
            autoOpenPanel: true,
            interactionToggle: true,
            Content: HtmlContent,
            Panel: CanvasNodeContentEditor,
            toolbar: canvasContentEditorToolbar,
            onDoubleClick: (ctx) => { ctx.openPanel(); return true; },
        },
    ],
});
