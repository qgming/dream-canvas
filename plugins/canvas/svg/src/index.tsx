// SVG 节点:编辑与渲染 SVG,透明背景直接融入画布;无自身内容时可取上游文本节点里的 SVG 源码。
import { definePlugin, useEffect } from "@dream-canvas/plugin-sdk";
import type { CanvasNodeContentProps } from "@dream-canvas/plugin-sdk";
import { useTranslation } from "react-i18next";
import { Shapes } from "lucide-react";
import { CanvasNodeContentEditor, canvasContentEditorToolbar } from "../../../../web/src/components/canvas/canvas-node-content-editor";

function SvgContent({ ctx }: CanvasNodeContentProps) {
    const { t } = useTranslation();

    const stored = ctx.node.metadata?.content as string | undefined;
    const upstream = ctx
        .getUpstream()
        .map((node) => node.metadata?.content)
        .find((text): text is string => typeof text === "string" && text.trim().startsWith("<svg"));
    const value = stored ?? "";
    const svg = value.trim() || upstream || "";

    // 无自身内容但有上游 SVG:自动采用上游源码
    useEffect(() => {
        if (stored === undefined && upstream) ctx.updateMetadata({ content: upstream });
    }, [ctx, stored, upstream]);

    return svg ? <div className="pointer-events-none flex size-full items-center justify-center p-3 [&_svg]:max-h-full [&_svg]:max-w-full" dangerouslySetInnerHTML={{ __html: svg }} />
        : <div className="pointer-events-none grid size-full place-items-center p-4 text-center text-sm text-muted-foreground">{t("canvas.contentEditor.empty", { name: "SVG" })}</div>;
}

export default definePlugin({
    id: "svg",
    name: "SVG 节点",
    version: "1.1.0",
    description: "透明背景渲染 SVG 矢量图,可接收上游文本节点的 SVG 源码",
    nodes: [
        {
            type: "svg:vector",
            title: "SVG",
            icon: <Shapes className="size-4" />,
            description: "渲染 SVG 矢量图",
            defaultSize: { width: 320, height: 320 },
            defaultMetadata: {},
            minimapColor: "#14b8a6",
            // 背景/边框透明,矢量图直接融入画布
            transparentBackground: true,
            autoOpenPanel: true,
            Content: SvgContent,
            Panel: CanvasNodeContentEditor,
            toolbar: canvasContentEditorToolbar,
            onDoubleClick: (ctx) => { ctx.openPanel(); return true; },
        },
    ],
});
