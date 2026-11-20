import { definePlugin } from "@dream-canvas/plugin-sdk";
import { ScanLine } from "lucide-react";
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
        onDoubleClick: (ctx) => { ctx.openPanel(); return true; },
    }],
});
