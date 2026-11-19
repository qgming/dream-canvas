import { LoaderCircle, Settings2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { buildGenerationConfig } from "@/lib/canvas/canvas-generation-helpers";
import { buildNodeGenerationContext, resolveNodeGenerationContext } from "./canvas-node-generation";
import { modelOptionLabel, useEffectiveConfig } from "@/stores/use-config-store";
import type { CanvasConnection, CanvasNodeData } from "@/types/canvas";

export function CanvasConfigNodePanel({ node, nodes, connections, isRunning, onComposerToggle }: { node: CanvasNodeData; nodes: CanvasNodeData[]; connections: CanvasConnection[]; isRunning: boolean; onComposerToggle: () => void }) {
    const { t } = useTranslation();
    const mode = node.metadata?.generationMode || "image";
    const config = buildGenerationConfig(useEffectiveConfig(), node, mode);
    const context = resolveNodeGenerationContext(config, buildNodeGenerationContext(node.id, nodes, connections, node.metadata?.composerContent ?? node.metadata?.prompt ?? ""));

    return <div className="flex h-full min-h-0 w-full cursor-move flex-col gap-3 p-4 text-sm">
        <div className="flex min-w-0 items-center gap-2 text-muted-foreground">
            {isRunning ? <LoaderCircle className="size-4 shrink-0 animate-spin motion-reduce:animate-none" /> : <Settings2 className="size-4 shrink-0" />}
            <span className="truncate text-xs font-medium">{t("canvas.configNode.title")}</span>
            <span className="ml-auto shrink-0 text-xs">{t(`canvas.configNode.${mode}`)}</span>
        </div>
        <p className="truncate text-xs text-muted-foreground">{config.model ? modelOptionLabel(config, config.model) : t("settingsPanels.model.select")}</p>
        <p className="line-clamp-3 whitespace-pre-wrap break-words text-sm leading-6">{context.prompt.trim() || t("canvas.configNode.editHint")}</p>
        <div className="mt-auto flex items-end gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {context.textCount ? <span>{t("canvas.configNode.prompt")} {context.textCount}</span> : null}
            {context.imageCount ? <span>{t("canvas.configNode.references")} {context.imageCount}</span> : null}
            {context.videoCount ? <span>{t("canvas.configNode.videoReferences")} {context.videoCount}</span> : null}
            {context.audioCount ? <span>{t("canvas.configNode.audioReferences")} {context.audioCount}</span> : null}
        </div>
        <Button variant="ghost" size="icon" icon={<Settings2 />} title={t("canvas.configNode.edit")} aria-label={t("canvas.configNode.edit")} onPointerDown={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()} onClick={onComposerToggle} />
        </div>
    </div>;
}
