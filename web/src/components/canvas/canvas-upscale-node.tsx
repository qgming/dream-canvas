import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, Download, ScanLine, Square } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import type { CanvasNodeContext } from "@dream-canvas/plugin-sdk";
import { ModelPicker } from "@/components/model-picker";
import { ModelInputFields } from "@/components/model-parameters";
import { Button } from "@/components/ui/button";
import { GenerationProgress } from "@/components/generation-progress";
import { useFeedback } from "@/hooks/use-feedback";
import { useDownloadMedia } from "@/hooks/use-download-media";
import { useOpenModelSettings } from "@/hooks/use-open-model-settings";
import { resourceKind } from "@/lib/canvas/canvas-resource-references";
import { upscaleGenerationInput, upscaleModelProfile, upscaleResource, upscaleSourceEntries, UPSCALE_ADD_REFERENCE_EVENT } from "@/lib/canvas/canvas-upscale";
import { findChannelModel, selectableModelsByCapability, useEffectiveConfig, type ChannelModel } from "@/stores/use-config-store";
import { useCanvasGenerationProgress } from "@/stores/use-generation-progress-store";
import { ApiError, captureSession } from "@/services/api/client";
import { AssetMedia } from "./asset-media";
import { CanvasNodeReferenceBar } from "./canvas-node-reference-bar";

export function CanvasUpscaleContent({ ctx }: { ctx: CanvasNodeContext }) {
    const { t } = useTranslation();
    const { id: projectId } = useParams();
    const download = useDownloadMedia();
    const metadata = ctx.node.metadata;
    const content = metadata?.content;
    const kind = upscaleResource(ctx.node)?.kind || "image";
    const progress = useCanvasGenerationProgress(projectId, ctx.node.id);

    if (metadata?.status === "loading") return <div className="grid size-full place-items-center p-4"><GenerationProgress task={progress} /></div>;
    return <div className="group/upscale relative size-full overflow-hidden rounded-xl">
        {content ? <AssetMedia kind={kind} src={content} assetKey={metadata?.storageKey} alt={ctx.node.title} videoPreview={kind === "video"} data-canvas-video={kind === "video" ? ctx.node.id : undefined} className="size-full object-contain" /> : <div className="flex size-full flex-col items-center justify-center gap-3 p-4 text-center text-sm text-muted-foreground"><ScanLine className="size-7" /><span>{t("canvas.upscale.empty")}</span></div>}
        {metadata?.status === "error" ? <div role="alert" className="absolute inset-x-0 top-0 max-h-full overflow-y-auto bg-background/95 p-3 text-xs leading-5 text-destructive">{metadata.errorDetails || t("workbench.generationFailed")}</div> : null}
        {content ? <div data-ui-overlay data-canvas-no-zoom data-canvas-shortcuts-ignore className="absolute right-2 top-2 z-10 opacity-0 transition-opacity group-hover/upscale:opacity-100 focus-within:opacity-100" onPointerDown={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()}><Button variant="ghost" size="icon" className="bg-background/90" icon={<Download />} aria-label={t("common.download")} title={t("common.download")} onClick={(event) => { event.stopPropagation(); void download({ url: content, storageKey: metadata?.storageKey }, ctx.node.title); }} /></div> : null}
    </div>;
}

export function CanvasUpscalePanel({ ctx }: { ctx: CanvasNodeContext }) {
    const { t } = useTranslation();
    const { notify } = useFeedback();
    const config = useEffectiveConfig();
    const openModelSettings = useOpenModelSettings();
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState("");
    const request = useRef(false);
    const entries = upscaleSourceEntries(ctx.node.id, ctx.getNodes(), ctx.getConnections());
    const source = entries.length === 1 ? entries[0].node : undefined;
    const kind = source ? resourceKind(source) as "image" | "video" : undefined;
    const eligible = useCallback((model: ChannelModel) => Boolean(upscaleModelProfile(model)) && (!kind || model.capability === kind), [kind]);
    const model = ctx.node.metadata?.model || (kind ? selectableModelsByCapability(config, kind).find((value) => eligible(findChannelModel(config, value)!.model)) : "") || "";
    const selected = findChannelModel(config, model)?.model;
    const parameters = ctx.node.metadata?.modelParameters?.[model];
    const profile = selected && upscaleModelProfile(selected, parameters);
    const running = submitting || ctx.node.metadata?.status === "loading";
    const problem = entries.length > 1 ? t("canvas.upscale.singleSource") : !source ? t("canvas.upscale.chooseSource") : !model ? t("canvas.upscale.noModels") : !profile || profile.kind !== kind ? t("canvas.upscale.modelMismatch") : "";
    const label = t(running ? "canvas.promptPanel.stopGeneration" : "canvas.upscale.generate");
    const canGenerate = !problem && Boolean(source && profile);
    const updateParameters = (value: Record<string, unknown>) => {
        if (kind === "image") {
            delete value.size;
            delete value.ratio;
        }
        setError("");
        ctx.updateMetadata({ modelParameters: { ...ctx.node.metadata?.modelParameters, [model]: value } });
    };

    useEffect(() => { if (model && !ctx.node.metadata?.model) ctx.updateMetadata({ model }); }, [ctx, model]);
    const changeModel = (value: string) => { setError(""); ctx.updateMetadata({ model: value }); };
    const generate = async () => {
        if (!source || !canGenerate || running || request.current) return;
        const assertSession = captureSession();
        request.current = true;
        setSubmitting(true);
        setError("");
        try {
            const current = upscaleSourceEntries(ctx.node.id, ctx.getNodes(), ctx.getConnections());
            if (current.length !== 1) throw new Error(t("canvas.upscale.singleSource"));
            const input = upscaleGenerationInput(config, model, current[0].node, parameters);
            ctx.updateMetadata({ status: "loading", errorDetails: undefined });
            if (input.kind === "image") await ctx.ai.generateImage("", { model, parameters: input.parameters, references: [input.url] });
            else await ctx.ai.generateVideo("", { model, parameters: input.parameters, videos: [input.url] });
        } catch (failure) {
            try { assertSession(); } catch { return; }
            if (failure instanceof Error && failure.name === "AbortError") return;
            const message = failure instanceof ApiError && failure.code === "upscale_source_dimensions_missing" ? t("canvas.upscale.sourceDimensionsMissing") : failure instanceof Error ? failure.message : t("workbench.generationFailed");
            if (ctx.getNode(ctx.node.id)?.metadata?.status === "loading") ctx.updateMetadata({ status: "error", errorDetails: message });
            setError(message);
            notify.error(message);
        } finally { request.current = false; setSubmitting(false); }
    };

    return <div data-ui-overlay data-canvas-no-zoom data-canvas-shortcuts-ignore className="flex max-h-[70dvh] min-h-0 flex-col gap-2 rounded-xl border p-3 shadow-lg backdrop-blur" style={{ background: ctx.theme.toolbar.panel, borderColor: ctx.theme.toolbar.border, color: ctx.theme.node.text }} onPointerDown={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
        <CanvasNodeReferenceBar nodeId={ctx.node.id} entries={entries} kinds={["image", "video"]} square disabled={running} onAdd={(nodeId, source) => ctx.emit(UPSCALE_ADD_REFERENCE_EVENT, { nodeId, source })} onDisconnect={(fromNodeId, toNodeId) => ctx.applyOps([{ type: "delete_connections", ids: ctx.getConnections().filter((connection) => connection.fromNodeId === fromNodeId && connection.toNodeId === toNodeId).map((connection) => connection.id) }])} />
        {problem || error ? <p role={error || entries.length > 1 || model && !profile ? "alert" : "status"} className={error || entries.length > 1 || model && !profile ? "text-xs leading-5 text-destructive" : "text-xs leading-5 text-muted-foreground"}>{error || problem}</p> : null}
        <div className="flex min-w-0 items-center gap-2">
            <div className="thin-scrollbar -m-0.5 flex min-w-0 flex-1 items-center gap-2 overflow-x-auto overflow-y-hidden p-0.5">
                <ModelPicker config={config} value={model} capability={kind} filterModel={eligible} emptyLabel={t("canvas.upscale.noModels")} onChange={changeModel} onMissingConfig={openModelSettings} disabled={running} className="w-40 min-w-0 max-w-48 shrink-0 px-2 text-xs" />
                {profile ? <ModelInputFields controls={profile.targets} value={parameters} resolvedValue={profile.values} compact inline presetOnlyKeys={kind === "image" ? [] : ["size"]} disabled={running} onChange={updateParameters} /> : null}
            </div>
            <Button variant={running ? "destructive" : "default"} size="icon" className="ml-auto rounded-full" icon={running ? <Square className="fill-current" /> : <ArrowUp />} aria-label={label} title={label} disabled={!running && !canGenerate} onClick={() => running ? ctx.ai.stopGeneration() : void generate()} />
        </div>
    </div>;
}
