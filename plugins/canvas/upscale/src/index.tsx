import { definePlugin } from "@dream-canvas/plugin-sdk";
import { ScanLine } from "lucide-react";
import i18n from "../../../../web/src/i18n";
import { CanvasUpscaleContent, CanvasUpscalePanel } from "../../../../web/src/components/canvas/canvas-upscale-node";
import { upscaleResource, UPSCALE_NODE_TYPE } from "../../../../web/src/lib/canvas/canvas-upscale";

export default definePlugin({
    id: "upscale",
    name: "超分",
    version: "1.0.0",
    nodes: [{
        type: UPSCALE_NODE_TYPE,
        title: "超分",
        icon: <ScanLine className="size-4" />,
        defaultSize: { width: 420, height: 280 },
        defaultMetadata: { content: "", status: "idle" },
        autoOpenPanel: true,
        keepAspectRatio: (node) => Boolean(node.metadata?.content),
        resource: upscaleResource,
        Content: CanvasUpscaleContent,
        Panel: CanvasUpscalePanel,
        toolbar: (ctx) => [{ id: "upscale-edit", title: i18n.t("canvas.upscale.edit"), label: i18n.t("canvas.upscale.edit"), icon: <ScanLine className="size-4" />, onClick: () => ctx.openPanel() }],
        onDoubleClick: (ctx) => { ctx.openPanel(); return true; },
    }],
});
