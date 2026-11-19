import { useEffect, useState } from "react";
import { ArrowUp, Maximize2, Settings2, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Popover } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTranslation } from "react-i18next";

import { useOpenModelSettings } from "@/hooks/use-open-model-settings";
import { ModelPicker } from "@/components/model-picker";
import { ModelInputFields, ModelParameters } from "@/components/model-parameters";
import { buildGenerationConfig, generationInputKinds } from "@/lib/canvas/canvas-generation-helpers";
import { buildNodeGenerationContext, buildNodeGenerationInputs, nodeInputReferences, resolveNodeGenerationContext } from "./canvas-node-generation";
import { inputIsMode, inputVisible } from "@/lib/model-inputs";
import { getNodeDefinition } from "@/lib/canvas/node-registry";
import { findChannelModel, firstModel, modelMatchesCapability, useEffectiveConfig } from "@/stores/use-config-store";
import type { ParameterControl } from "@/services/api/channels";
import { canvasThemes } from "@/lib/canvas-theme";
import { cn } from "@/lib/utils";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasPromptLibrary } from "./canvas-prompt-library";
import { CanvasPromptChipInput } from "./canvas-prompt-chip-input";
import { CanvasConfigComposer } from "./canvas-config-composer";
import { CanvasNodeType, type CanvasConnection, type CanvasGenerationMode, type CanvasNodeData } from "@/types/canvas";
import { getGenerationReferenceTarget, getNodeReferenceEntries, type CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { CanvasNodeReferenceBar, type CanvasReferenceSource } from "./canvas-node-reference-bar";

export type CanvasNodeGenerationMode = CanvasGenerationMode;

type CanvasNodePromptPanelProps = {
    node: CanvasNodeData;
    isRunning: boolean;
    onPromptChange: (nodeId: string, prompt: string) => void;
    onConfigChange: (nodeId: string, patch: Partial<CanvasNodeData["metadata"]>) => void;
    onGenerate: (nodeId: string, mode: CanvasNodeGenerationMode, prompt: string) => void;
    onStop: (nodeId: string) => void;
    mentionReferences?: CanvasResourceReference[];
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    onDisconnectReference?: (fromNodeId: string, toNodeId: string) => void;
    onAddReference?: (nodeId: string, source: CanvasReferenceSource) => void;
    onReorderReferences?: (nodeId: string, ids: string[], prompt: string) => void;
    modeOverride?: CanvasNodeGenerationMode; // Plugin nodes set their generation type through useBuiltinPanel.mode.
};

export function CanvasNodePromptPanel({ node, nodes, connections, isRunning, onPromptChange, onConfigChange, onGenerate, onStop, mentionReferences = [], onDisconnectReference, onAddReference, onReorderReferences, modeOverride }: CanvasNodePromptPanelProps) {
    const { t } = useTranslation();
    const globalConfig = useEffectiveConfig();
    const openModelSettings = useOpenModelSettings();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const isConfigNode = node.type === CanvasNodeType.Config;
    const isTextNode = node.type === CanvasNodeType.Text;
    const isImageNode = node.type === CanvasNodeType.Image;
    const mode = modeOverride ?? (isConfigNode ? node.metadata?.generationMode || "image" : defaultMode(node.type));
    const singleLineFooter = mode === "video" || mode === "audio";
    const config = buildGenerationConfig(globalConfig, node, mode);
    const modelParameters = node.metadata?.modelParameters?.[config.model];
    const primaryControl = (control: ParameterControl) => isTextNode ? !control.advanced && control.key !== "systemPrompt" && control.key !== "reasoning_effort" : isPrimaryControl(control, mode);
    const settings = isTextNode ? [] : (findChannelModel(config, config.model)?.model.parameters || []).filter((control) => !control.hidden && control.type !== "reference" && !primaryControl(control) && inputVisible(control, config.modelParameters || {})).map((control) => ({ ...control, advanced: false }));
    const updateParameters = (value: Record<string, unknown>) => onConfigChange(node.id, { modelParameters: { ...node.metadata?.modelParameters, [config.model]: value } });
    const inputKinds = generationInputKinds(config);
    const includeSourceImage = isImageNode && globalConfig.nodeRegenerateBehavior !== "overwrite";
    const referenceEntries = getNodeReferenceEntries(node.id, nodes, connections, includeSourceImage);
    const referenceTargetId = getGenerationReferenceTarget(node.id, nodes, connections);
    const disconnectReference = onDisconnectReference ? (fromNodeId: string) => onDisconnectReference(fromNodeId, referenceTargetId) : undefined;
    const inputs = buildNodeGenerationInputs(node.id, nodes, connections, includeSourceImage);
    const references = nodeInputReferences(inputs);
    const activeMentions = mentionReferences.filter((reference) => inputKinds.includes(reference.kind));
    const hasTextContent = isTextNode && Boolean(node.metadata?.content?.trim());
    const hasImageContent = isImageNode && Boolean(node.metadata?.content);
    const isEditingExistingContent = hasTextContent || hasImageContent;
    const [promptDraft, setPrompt] = useState(node.metadata?.composerContent ?? node.metadata?.prompt ?? "");
    const prompt = isConfigNode ? node.metadata?.composerContent ?? node.metadata?.prompt ?? "" : promptDraft;
    const [expanded, setExpanded] = useState(false);
    const requestPrompt = mode === "text" && hasTextContent ? t("canvas.projectPage.editTextPrompt", { source: node.metadata!.content!.trim(), prompt }) : (getNodeDefinition(node.type)?.useBuiltinPanel?.promptPrefix || "") + prompt;
    const context = resolveNodeGenerationContext(config, buildNodeGenerationContext(node.id, nodes, connections, requestPrompt, includeSourceImage));
    const canGenerate = (!hasTextContent || Boolean(prompt.trim())) && Boolean(context.prompt.trim());
    const referenceOrderKey = JSON.stringify(node.metadata?.referenceOrder || []);

    useEffect(() => {
        setPrompt(node.metadata?.composerContent ?? node.metadata?.prompt ?? "");
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [node.id, referenceOrderKey]);

    const updatePrompt = (value: string) => {
        setPrompt(value);
        if (isConfigNode || isEditingExistingContent) onConfigChange(node.id, { composerContent: value });
        else onPromptChange(node.id, value);
    };

    const submit = () => {
        const text = prompt.trim();
        if (!canGenerate || isRunning) return;
        onGenerate(node.id, mode, text);
    };

    const referenceBarProps = { nodeId: node.id, entries: referenceEntries, kinds: inputKinds, square: true, disabled: isRunning, onDisconnect: disconnectReference, onAdd: onAddReference, onReorder: !isConfigNode && onReorderReferences ? (ids: string[]) => onReorderReferences(node.id, ids, prompt) : undefined };
    const placeholder = t(`canvas.promptPanel.${mode === "image" && hasImageContent ? "editImage" : mode === "text" && hasTextContent ? "editText" : mode}`);
    const placeholderClassName = "left-0 right-0 top-0 leading-6";
    const expandLabel = t("canvas.promptPanel.expandEditor");
    const generationLabel = t(isRunning ? "canvas.promptPanel.stopGeneration" : "canvas.promptPanel.generate");
    const generationIcon = isRunning ? <Square className="size-3.5 fill-current" /> : <ArrowUp className="size-4" />;
    const modelPicker = <ModelPicker config={config} value={config.model} onChange={(model) => onConfigChange(node.id, { model })} capability={mode} disabled={isRunning} onMissingConfig={openModelSettings} className={cn("min-w-0 max-w-48", singleLineFooter && "w-28 max-w-28 shrink-0 px-2 text-xs")} />;
    const parameterFields = (["mode", "parameters"] as const).map((section) => <ModelParameters key={`${config.model}:${section}`} config={config} model={config.model} value={modelParameters} section={section} compact inline references={references} disabled={isRunning} onChange={updateParameters} filterControls={primaryControl} />);
    const editorActions = <div className="flex shrink-0 items-center gap-1">
        <CanvasPromptLibrary onSelect={updatePrompt} type={mode === "audio" ? "text" : mode} />
        <Button variant="ghost" size="icon" className="size-7 [&_svg]:size-3.5" icon={<Maximize2 />} onClick={() => setExpanded(true)} aria-label={expandLabel} title={expandLabel} />
    </div>;

    return (
        <div
            data-ui-overlay data-canvas-no-zoom data-canvas-shortcuts-ignore
            className="flex max-h-[70dvh] min-h-0 flex-col rounded-xl border p-4 shadow-lg backdrop-blur"
            style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
        >
            <div className="mb-3 flex min-w-0 shrink-0 items-start gap-2">
                <CanvasNodeReferenceBar {...referenceBarProps} />
                {editorActions}
            </div>
            <div className="thin-scrollbar min-h-0 overflow-x-hidden overflow-y-auto overscroll-contain">
                    {isConfigNode ? <CanvasConfigComposer nodeId={node.id} nodes={nodes} inputs={inputs} value={prompt} onChange={updatePrompt} /> : <CanvasPromptChipInput
                        value={prompt}
                        references={activeMentions}
                        onChange={updatePrompt}
                        onSubmit={submit}
                        className="thin-scrollbar min-h-[3lh] max-h-[10lh] w-full cursor-text overflow-x-hidden overflow-y-auto rounded-lg bg-transparent text-sm leading-6 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/30"
                        placeholder={placeholder}
                        placeholderClassName={placeholderClassName}
                    />}
            </div>
            <div className={cn("mt-3 flex min-w-0 shrink-0 gap-2", singleLineFooter ? "items-center" : "items-end")}>
                <div className={cn("flex min-w-0 flex-1 items-center", singleLineFooter ? "thin-scrollbar -m-0.5 gap-1.5 overflow-x-auto overflow-y-hidden p-0.5" : "flex-wrap gap-2")}>
                    {isConfigNode ? <Select value={mode} disabled={isRunning} onValueChange={(value) => { const nextMode = value as CanvasGenerationMode; onConfigChange(node.id, { generationMode: nextMode, model: modelMatchesCapability(config, config.model, nextMode) ? config.model : firstModel(config, nextMode) }); }}>
                        <SelectTrigger size="sm" className="w-auto shrink-0 gap-1 px-2 text-xs" aria-label={t("canvas.configNode.outputType")}><SelectValue /></SelectTrigger>
                        <SelectContent>{["image", "text", "video", "audio"].map((value) => <SelectItem key={value} value={value}>{t(`canvas.configNode.${value}`)}</SelectItem>)}</SelectContent>
                    </Select> : null}
                    {modelPicker}{parameterFields}
                </div>
                {settings.length ? <Popover key={`${node.id}:${config.model}`} trigger="click" placement="topRight" className="thin-scrollbar w-[356px]" content={<div onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}><ModelInputFields controls={settings} value={modelParameters} resolvedValue={config.modelParameters} compact references={references} disabled={isRunning} onChange={updateParameters} /></div>}>
                    <Button variant="ghost" size="icon" icon={<Settings2 />} disabled={isRunning} title={t("workbench.settings")} aria-label={t("workbench.settings")} />
                </Popover> : null}
                <Button
                    variant={isRunning ? "destructive" : "default"}
                    size="icon"
                    className="ml-auto rounded-full"
                    icon={generationIcon}
                    title={generationLabel}
                    aria-busy={isRunning}
                    disabled={!isRunning && !canGenerate}
                    onClick={() => (isRunning ? onStop(node.id) : submit())}
                    aria-label={generationLabel}
                />
            </div>
            <Dialog title={t("canvas.promptPanel.editorTitle")} open={expanded} width={760} footer={null} onClose={() => setExpanded(false)}>
                <div data-canvas-no-zoom className="pt-2" onWheelCapture={(event) => event.stopPropagation()}>
                    <CanvasNodeReferenceBar {...referenceBarProps} onAdd={onAddReference && ((nodeId, source) => { if (source !== "upload") setExpanded(false); onAddReference(nodeId, source); })} />
                    <div className="mt-2">{isConfigNode ? <CanvasConfigComposer nodeId={node.id} nodes={nodes} inputs={inputs} value={prompt} onChange={updatePrompt} className="h-[52dvh] min-h-80 max-h-none" /> : <CanvasPromptChipInput
                        value={prompt}
                        references={activeMentions}
                        onChange={updatePrompt}
                        className="thin-scrollbar h-[52dvh] min-h-80 w-full cursor-text overflow-y-auto rounded-xl text-sm leading-6 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/30"
                        style={{ background: "transparent", borderColor: theme.toolbar.border, color: theme.node.text }}
                        placeholder={placeholder}
                        placeholderClassName={placeholderClassName}
                    />}</div>
                </div>
            </Dialog>
        </div>
    );
}

function defaultMode(type: CanvasNodeData["type"]): CanvasNodeGenerationMode {
    return type === CanvasNodeType.Text ? "text" : type === CanvasNodeType.Video ? "video" : type === CanvasNodeType.Audio ? "audio" : "image";
}

function isPrimaryControl(control: ParameterControl, mode: CanvasGenerationMode) {
    if (inputIsMode(control) || mode === "image") return true;
    if (mode === "video") return !control.advanced && ["ratio", "size", "resolution", "duration", "seconds"].includes(control.key);
    if (mode === "audio") return !control.advanced && ["voice", "format", "speed"].includes(control.key);
    return !control.advanced && !["textarea", "text", "reference"].includes(control.type);
}

