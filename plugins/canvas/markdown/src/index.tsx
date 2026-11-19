// Markdown 节点:编辑与渲染 Markdown。marked 从 CDN 按需加载,不打进插件体积。
// 防闪烁:解析结果按源码模块级缓存,且只在 HTML 真正变化时写入 DOM——
//   画布任何重渲染都不会重新解析或重载 Markdown 里的图片。
// styles.css 由 esbuild 以 text 方式打进 bundle,通过 plugin.css 自动注入。
import { definePlugin, useEffect, useRef, useState } from "@dream-canvas/plugin-sdk";
import type { CanvasNodeContentProps } from "@dream-canvas/plugin-sdk";
import { useTranslation } from "react-i18next";
import { FileText } from "lucide-react";
import { CanvasNodeContentEditor, canvasContentEditorToolbar } from "../../../../web/src/components/canvas/canvas-node-content-editor";
import i18n from "../../../../web/src/i18n";

import css from "./styles.css?raw";

type Marked = { parse: (src: string) => string };

let marked: Marked | undefined; // 加载完成后的 marked 实例,模块级缓存,后续同步渲染
let markedPromise: Promise<Marked> | undefined;
function loadMarked(): Promise<Marked> {
    if (marked) return Promise.resolve(marked);
    if (!markedPromise) markedPromise = import(/* @vite-ignore */ "https://esm.sh/marked@14").then((mod: { marked: Marked }) => (marked = mod.marked));
    return markedPromise;
}

// 解析结果按源码缓存(模块级):同一段 Markdown 只解析一次,重复渲染/重挂载都命中缓存,
// 返回的是同一个字符串引用,配合下方「值不变不写 DOM」彻底避免图片被重新请求。
const htmlCache = new Map<string, string>();
function renderMarkdown(source: string): string {
    if (!marked) return "";
    const key = source || i18n.t("canvas.contentEditor.empty", { name: "Markdown" });
    let out = htmlCache.get(key);
    if (out === undefined) {
        out = marked.parse(key);
        htmlCache.set(key, out);
    }
    return out;
}

// 预览态:用 ref 手动写 innerHTML,且仅在 html 真正变化时写入。
// 这样宿主的任何重渲染(点击、移动视角、选中态变化等)都不会触碰已渲染的 DOM,图片不会重新加载。
function MarkdownPreview({ ctx }: CanvasNodeContentProps) {
    useTranslation();
    const [, force] = useState(0);
    const ref = useRef<HTMLDivElement>(null);
    const lastHtml = useRef<string | null>(null);

    // marked 未就绪时按需加载,加载完触发一次重渲染填充内容
    useEffect(() => {
        if (marked) return;
        let alive = true;
        loadMarked().then(() => alive && force((n) => n + 1));
        return () => {
            alive = false;
        };
    }, []);

    const source = (ctx.node.metadata?.content as string | undefined) || "";
    const html = renderMarkdown(source);

    useEffect(() => {
        const el = ref.current;
        if (!el || lastHtml.current === html) return; // 内容没变:不动 DOM,已加载的图片保持原样
        el.innerHTML = html;
        lastHtml.current = html;
    }, [html]);

    return <div ref={ref} className="cnv-md" data-canvas-no-zoom onWheel={(e) => e.stopPropagation()} style={{ height: "100%", width: "100%", color: ctx.theme.node.text }} />;
}

export default definePlugin({
    id: "markdown",
    name: "Markdown 节点",
    version: "1.1.0",
    description: "在画布中编辑与渲染 Markdown",
    css,
    nodes: [
        {
            type: "markdown:doc",
            title: "Markdown",
            icon: <FileText className="size-4" />,
            description: "编辑与渲染 Markdown",
            defaultSize: { width: 360, height: 300 },
            defaultMetadata: { content: "" },
            minimapColor: "#6366f1",
            autoOpenPanel: true,
            interactionToggle: true,
            resource: (node) => ({ kind: "text", text: node.metadata?.content }),
            Content: MarkdownPreview,
            Panel: CanvasNodeContentEditor,
            toolbar: canvasContentEditorToolbar,
            onDoubleClick: (ctx) => { ctx.openPanel(); return true; },
        },
    ],
});
