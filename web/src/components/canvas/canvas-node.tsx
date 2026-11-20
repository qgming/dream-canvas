import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Download, Image as ImageIcon, Music2, Puzzle, RefreshCw, Trash2, Video } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { formatBytes, formatRatio } from "@/lib/image-utils";
import { pickImageSource } from "@/lib/image-thumbnail";
import { previewUrlFor, subscribeImagePreviews, getImagePreviewRevision } from "@/services/image-storage";
import { getNodeDefinition, isNodeTypeEnabled } from "@/lib/canvas/node-registry";
import { buildNodeContext } from "@/lib/canvas/plugin-node-context";
import { upscaleResource, UPSCALE_NODE_TYPE } from "@/lib/canvas/canvas-upscale";
import { nodeResults } from "@/lib/canvas/canvas-node-results";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasResourceMentionTextarea } from "./canvas-resource-mention-textarea";
import { CanvasNodeType, type CanvasNodeData, type CanvasNodeImage, type CanvasNodeText, type Position } from "@/types/canvas";
import type { CanvasNodeContext, CanvasPluginHost } from "@/types/canvas-plugin";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { useTranslation } from "react-i18next";
import { AssetMedia } from "./asset-media";
import { GenerationProgress } from "@/components/generation-progress";
import { canvasGenerationTask, useCanvasGenerationProgress, useGenerationProgressStore } from "@/stores/use-generation-progress-store";
import { useParams } from "react-router-dom";

type ResizeCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

type CanvasNodeProps = {
    data: CanvasNodeData;
    displayName: string;
    scale: number;
    isSelected: boolean;
    isRelated: boolean;
    isFocusRelated: boolean;
    isConnectionTarget: boolean;
    isConnecting: boolean;
    referenceSelectionState?: "target" | "disabled" | "available";
    showPanel: boolean;
    showParameterInfo: boolean;
    mentionReferences?: CanvasResourceReference[];
    pluginHost?: CanvasPluginHost;
    registryVersion?: number;
    renderPanel?: (node: CanvasNodeData) => ReactNode;
    renderNodeContent?: (node: CanvasNodeData) => ReactNode;
    groupChildCount?: number;
    isGroupDropTarget?: boolean;
    onMouseDown: (event: React.MouseEvent, nodeId: string) => void;
    onSelectCapture?: (event: React.MouseEvent, nodeId: string) => void;
    onHoverStart: (nodeId: string) => void;
    onHoverEnd: (nodeId: string) => void;
    onConnectStart: (event: React.MouseEvent, nodeId: string, handleType: "source" | "target") => void;
    onResizeStart: (nodeId: string) => void;
    onResize: (nodeId: string, width: number, height: number, position?: Position) => void;
    onResizeEnd: (nodeId: string) => void;
    onContentChange: (nodeId: string, content: string) => void;
    onTitleChange: (nodeId: string, title: string) => void;
    onOpenResults?: (nodeId: string) => void;
    onDownloadBatchImage?: (node: CanvasNodeData, imageId: string) => void;
    onRetryBatchImage?: (node: CanvasNodeData, imageId: string) => void;
    onDeleteBatchImage?: (nodeId: string, imageId: string) => void;
    onRetry?: (node: CanvasNodeData) => void;
    onViewImage?: (node: CanvasNodeData, imageId?: string) => void;
    onSelectReference?: (nodeId: string) => void;
    onContextMenu: (event: React.MouseEvent, nodeId: string) => void;
};

type NodeContentRendererProps = {
    node: CanvasNodeData;
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    isEditingContent: boolean;
    textareaRef: React.RefObject<HTMLTextAreaElement | null>;
    isBatchRoot: boolean;
    scale: number;
    renderNodeContent?: (node: CanvasNodeData) => ReactNode;
    pluginContext?: CanvasNodeContext | null;
    onContentChange: (nodeId: string, content: string) => void;
    onStopEditing: () => void;
    mentionReferences: CanvasResourceReference[];
    onRetry?: (node: CanvasNodeData) => void;
    onDownloadBatchImage?: (imageId: string) => void;
    onRetryBatchImage?: (imageId: string) => void;
    onDeleteBatchImage?: (imageId: string) => void;
};

export const CanvasNode = React.memo(function CanvasNode({
    data,
    displayName,
    scale,
    isSelected,
    isRelated,
    isFocusRelated,
    isConnectionTarget,
    isConnecting,
    referenceSelectionState,
    showPanel,
    showParameterInfo,
    mentionReferences = [],
    pluginHost,
    renderPanel,
    renderNodeContent,
    groupChildCount = 0,
    isGroupDropTarget = false,
    onMouseDown,
    onSelectCapture,
    onHoverStart,
    onHoverEnd,
    onConnectStart,
    onResizeStart,
    onResize,
    onResizeEnd,
    onContentChange,
    onTitleChange,
    onOpenResults,
    onDownloadBatchImage,
    onRetryBatchImage,
    onDeleteBatchImage,
    onRetry,
    onViewImage,
    onSelectReference,
    onContextMenu,
}: CanvasNodeProps) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { t } = useTranslation();
    const [hovered, setHovered] = useState(false);
    const registeredDefinition = getNodeDefinition(data.type);
    const definition = isNodeTypeEnabled(data.type) ? registeredDefinition : undefined;
    const pluginContext = useMemo<CanvasNodeContext | null>(() => (pluginHost ? buildNodeContext(pluginHost, data, theme, scale, isSelected) : null), [pluginHost, data, theme, scale, isSelected]);
    const [isEditingContent, setIsEditingContent] = useState(false);
    const [isEditingTitle, setIsEditingTitle] = useState(false);
    const [titleDraft, setTitleDraft] = useState("");
    const initialTitle = useRef("");
    const hasImageContent = data.type === CanvasNodeType.Image && Boolean(data.metadata?.content);
    const hasVideoContent = data.type === CanvasNodeType.Video && Boolean(data.metadata?.content);
    const hasAudioContent = data.type === CanvasNodeType.Audio && Boolean(data.metadata?.content);
    const hasUpscaleContent = data.type === UPSCALE_NODE_TYPE && Boolean(data.metadata?.content);
    const showMediaInfo = showParameterInfo && (hasImageContent || hasVideoContent || hasUpscaleContent) && data.metadata?.status !== "loading";
    const isGroup = data.type === CanvasNodeType.Group;
    const batchCount = nodeResults(data).length;
    const isBatchRoot = batchCount > 1;
    // Nodes with the interaction/move toggle ignore content pointer events in move mode and allow interaction in interactive mode.
    // forceInteractive states such as editing stay interactive, as do empty nodes so their upload and generation actions remain usable.
    const supportsInteractionToggle = Boolean(definition?.interactionToggle);
    const forceInteractive = supportsInteractionToggle ? Boolean(definition?.forceInteractive?.(data)) : false;
    const contentInteractive = !supportsInteractionToggle || forceInteractive || !data.metadata?.content ? true : Boolean(data.metadata?.interactive);
    const transparentBg = Boolean(definition?.transparentBackground);
    const isActive = isConnectionTarget || isSelected || isFocusRelated;
    const imageBorderColor = isActive ? theme.canvas.selectionStroke : isRelated ? theme.node.muted : "transparent";
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const resizeRef = useRef({
        isResizing: false,
        corner: "bottom-right" as ResizeCorner,
        startX: 0,
        startY: 0,
        startLeft: 0,
        startTop: 0,
        startWidth: 0,
        startHeight: 0,
        keepRatio: false,
        ratio: 1,
    });

    const startTitleEditing = useCallback(() => {
        initialTitle.current = displayName;
        setTitleDraft(displayName);
        setIsEditingTitle(true);
    }, [displayName]);
    const finishTitleEditing = useCallback(() => {
        const title = titleDraft.trim();
        if (!title) return;
        if (title !== initialTitle.current) onTitleChange(data.id, title);
        setIsEditingTitle(false);
    }, [data.id, onTitleChange, titleDraft]);

    useEffect(() => {
        const textarea = textareaRef.current;
        if (!textarea) return;

        const handleWheel = (event: WheelEvent) => event.stopPropagation();
        textarea.addEventListener("wheel", handleWheel, { passive: false });
        return () => textarea.removeEventListener("wheel", handleWheel);
    }, [data.type, isEditingContent]);

    useEffect(() => {
        if (!isEditingContent) return;
        const textarea = textareaRef.current;
        textarea?.focus();
        textarea?.setSelectionRange(textarea.value.length, textarea.value.length);
    }, [isEditingContent]);

    useEffect(() => {
        if (!isEditingContent) return;

        const handleOutsidePointerDown = (event: PointerEvent) => {
            const target = event.target;
            if (!(target instanceof Node)) return;
            if (isEditingContent && textareaRef.current?.contains(target)) return;

            setIsEditingContent(false);
        };

        window.addEventListener("pointerdown", handleOutsidePointerDown, true);
        return () => window.removeEventListener("pointerdown", handleOutsidePointerDown, true);
    }, [isEditingContent]);

    const handleResizeMove = useCallback(
        (event: MouseEvent) => {
            if (!resizeRef.current.isResizing) return;

            const dx = (event.clientX - resizeRef.current.startX) / scale;
            const dy = (event.clientY - resizeRef.current.startY) / scale;
            const minWidth = 220;
            const minHeight = 160;
            const startRight = resizeRef.current.startLeft + resizeRef.current.startWidth;
            const startBottom = resizeRef.current.startTop + resizeRef.current.startHeight;
            const fromLeft = resizeRef.current.corner.includes("left");
            const fromTop = resizeRef.current.corner.includes("top");
            const rawWidth = Math.max(minWidth, resizeRef.current.startWidth + (fromLeft ? -dx : dx));
            const rawHeight = Math.max(minHeight, resizeRef.current.startHeight + (fromTop ? -dy : dy));
            let width = rawWidth;
            let height = rawHeight;
            if (resizeRef.current.keepRatio) {
                const ratio = resizeRef.current.ratio;
                if (Math.abs(dx) >= Math.abs(dy)) {
                    height = width / ratio;
                } else {
                    width = height * ratio;
                }
                if (height < minHeight) {
                    height = minHeight;
                    width = height * ratio;
                }
                if (width < minWidth) {
                    width = minWidth;
                    height = width / ratio;
                }
            }

            onResize(data.id, width, height, {
                x: fromLeft ? startRight - width : resizeRef.current.startLeft,
                y: fromTop ? startBottom - height : resizeRef.current.startTop,
            });
        },
        [data.id, onResize, scale],
    );

    const handleResizeUp = useCallback(() => {
        resizeRef.current.isResizing = false;
        window.removeEventListener("mousemove", handleResizeMove);
        window.removeEventListener("mouseup", handleResizeUp);
        window.removeEventListener("blur", handleResizeUp);
        onResizeEnd(data.id);
    }, [data.id, handleResizeMove, onResizeEnd]);

    const handleResizeMouseDown = (event: React.MouseEvent, corner: ResizeCorner) => {
        event.stopPropagation();
        event.preventDefault();
        onResizeStart(data.id);
        resizeRef.current = {
            isResizing: true,
            corner,
            startX: event.clientX,
            startY: event.clientY,
            startLeft: data.position.x,
            startTop: data.position.y,
            startWidth: data.width,
            startHeight: data.height,
            keepRatio: (data.type === CanvasNodeType.Image && !data.metadata?.freeResize) || data.type === CanvasNodeType.Video || Boolean(definition?.keepAspectRatio?.(data)),
            ratio: (data.metadata?.naturalWidth || data.width) / (data.metadata?.naturalHeight || data.height || 1),
        };
        window.addEventListener("mousemove", handleResizeMove);
        window.addEventListener("mouseup", handleResizeUp);
        window.addEventListener("blur", handleResizeUp);
    };

    useEffect(() => {
        return () => {
            window.removeEventListener("mousemove", handleResizeMove);
            window.removeEventListener("mouseup", handleResizeUp);
            window.removeEventListener("blur", handleResizeUp);
            if (resizeRef.current.isResizing) handleResizeUp();
        };
    }, [handleResizeMove, handleResizeUp]);

    return (
        <>
        <div
            data-node-id={data.id}
            className={`node-element group/node absolute flex select-none flex-col transition-shadow ${isGroup ? "z-[5]" : isSelected ? "z-50" : "z-10"} ${referenceSelectionState === "available" ? "cursor-pointer" : referenceSelectionState ? "cursor-not-allowed" : ""}`}
            style={{
                transform: `translate(${data.position.x}px, ${data.position.y}px)`,
                width: data.width,
                height: data.height,
                contain: "layout style",
            }}
            onMouseEnter={() => {
                setHovered(true);
                onHoverStart(data.id);
            }}
            onMouseLeave={() => {
                setHovered(false);
                onHoverEnd(data.id);
            }}
            onMouseDownCapture={(event) => {
                if (!referenceSelectionState) onSelectCapture?.(event, data.id);
            }}
            onContextMenu={(event) => {
                if (referenceSelectionState) event.preventDefault();
                else onContextMenu(event, data.id);
            }}
        >
            <div className="pointer-events-none absolute inset-x-0 top-[-28px] z-[65] flex h-6 items-center gap-2" style={{ color: theme.node.text }}>
                <div className="min-w-0 flex-1">
                    <Button variant="ghost" size="sm" className="pointer-events-auto h-6 max-w-full justify-start gap-1.5 border-0 bg-transparent px-0 py-0 text-xs font-medium text-inherit hover:bg-transparent" data-ui-overlay data-canvas-no-zoom data-canvas-shortcuts-ignore title={t("canvas.node.renameHint")} aria-label={`${t("canvas.project.rename")} ${displayName}`} aria-haspopup="dialog" onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); startTitleEditing(); }}>
                        <span aria-hidden className="flex size-3.5 shrink-0 items-center justify-center [&_svg]:size-3.5">{registeredDefinition?.icon || <Puzzle />}</span>
                        <span className="truncate">{displayName}</span>
                    </Button>
                </div>
                {showMediaInfo ? <MediaInfoBar node={data} /> : null}
                {isGroup ? <span className="ml-auto shrink-0 text-xs font-medium tabular-nums text-muted-foreground" aria-label={t("canvas.node.nodeCount", { count: groupChildCount })}>{groupChildCount}</span> : null}
            </div>

            <div
                className="relative h-full w-full overflow-visible rounded-xl border-2"
                style={{
                    background: isGroup ? "transparent" : hasImageContent || hasVideoContent || transparentBg ? "transparent" : theme.node.fill,
                    borderColor: isGroup ? (isGroupDropTarget || isActive ? theme.canvas.selectionStroke : theme.node.faint) : hasImageContent ? imageBorderColor : isActive ? theme.canvas.selectionStroke : isRelated ? theme.node.muted : transparentBg ? "transparent" : theme.node.stroke,
                    borderStyle: isGroup ? "dashed" : "solid",
                    boxShadow: isGroupDropTarget ? `0 0 0 2px ${theme.canvas.selectionStroke}66, inset 0 0 0 999px ${theme.canvas.selectionStroke}10` : isActive ? `0 0 0 1px ${theme.canvas.selectionStroke}55` : isRelated ? `0 0 0 1px ${theme.node.muted}55, 0 18px 48px rgba(0,0,0,.14)` : undefined,
                }}
                onMouseDown={(event) => {
                    if (!referenceSelectionState) onMouseDown(event, data.id);
                    else if (event.button === 0 && referenceSelectionState === "available") {
                        event.stopPropagation();
                        onSelectReference?.(data.id);
                    }
                }}
                onDoubleClick={(event) => {
                    if (!isNodeTypeEnabled(data.type)) return;
                    if (referenceSelectionState) {
                        event.stopPropagation();
                        return;
                    }
                    if (definition?.onDoubleClick && pluginContext) {
                        if (definition.onDoubleClick(pluginContext)) event.stopPropagation();
                        return;
                    }
                    if (data.type === CanvasNodeType.Image && hasImageContent) {
                        event.stopPropagation();
                        onViewImage?.(data);
                        return;
                    }
                    if (data.type !== CanvasNodeType.Text) return;
                    event.stopPropagation();
                    setIsEditingContent(true);
                }}
            >
                <div
                    className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-[inherit]"
                    style={
                        {
                            background: isGroup ? "transparent" : hasImageContent || hasVideoContent || transparentBg ? "transparent" : theme.node.fill,
                            pointerEvents: contentInteractive ? undefined : "none",
                        } as React.CSSProperties
                    }
                >
                    <NodeContent
                        node={data}
                        theme={theme}
                        isEditingContent={isEditingContent}
                        textareaRef={textareaRef}
                        isBatchRoot={isBatchRoot}
                        scale={scale}
                        renderNodeContent={renderNodeContent}
                        pluginContext={pluginContext}
                        mentionReferences={mentionReferences}
                        onContentChange={onContentChange}
                        onStopEditing={() => setIsEditingContent(false)}
                        onRetry={onRetry}
                        onDownloadBatchImage={(imageId) => onDownloadBatchImage?.(data, imageId)}
                        onRetryBatchImage={(imageId) => onRetryBatchImage?.(data, imageId)}
                        onDeleteBatchImage={(imageId) => onDeleteBatchImage?.(data.id, imageId)}
                    />
                </div>

                {!isGroup && !hasImageContent && !hasVideoContent && !hasAudioContent && !hasUpscaleContent ? <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12" style={{ background: `linear-gradient(to top, ${theme.node.panel}66, transparent)` }} /> : null}

                {referenceSelectionState && (referenceSelectionState !== "available" || hovered) ? (
                    <div className="pointer-events-none absolute inset-0 z-[60] grid place-items-center rounded-[inherit]" style={{ background: `color-mix(in srgb, ${theme.canvas.background} ${referenceSelectionState === "target" ? 78 : referenceSelectionState === "disabled" ? 60 : 34}%, transparent)`, boxShadow: referenceSelectionState === "available" ? `inset 0 0 0 2px ${theme.canvas.selectionStroke}` : undefined }}>
                        {referenceSelectionState !== "disabled" ? <span className="rounded-lg px-3 py-2 text-sm font-medium shadow-sm" style={{ background: theme.toolbar.panel, color: theme.node.text }}>{t(referenceSelectionState === "target" ? "canvas.references.selecting" : "canvas.references.choose")}</span> : null}
                    </div>
                ) : null}

                {!referenceSelectionState ? <ResizeHandle corner="top-left" onMouseDown={handleResizeMouseDown} /> : null}
                {!referenceSelectionState ? <ResizeHandle corner="top-right" onMouseDown={handleResizeMouseDown} /> : null}
                {!referenceSelectionState ? <ResizeHandle corner="bottom-left" onMouseDown={handleResizeMouseDown} /> : null}
                {!referenceSelectionState ? <ResizeHandle corner="bottom-right" onMouseDown={handleResizeMouseDown} /> : null}
            </div>

            {isBatchRoot && !referenceSelectionState && isNodeTypeEnabled(data.type) ? <Button size="sm" className="absolute bottom-0 left-full z-[65] h-7 min-w-7 bg-popover px-2 text-xs font-medium tabular-nums text-muted-foreground hover:text-foreground" style={{ marginLeft: 12 / scale, transform: `scale(${1 / scale})`, transformOrigin: "left bottom" }} data-ui-overlay data-canvas-no-zoom data-canvas-shortcuts-ignore title={t("canvas.results.open", { count: batchCount })} aria-label={t("canvas.results.open", { count: batchCount })} aria-haspopup="dialog" onClick={(event) => { event.stopPropagation(); onOpenResults?.(data.id); }} onDoubleClick={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
                {batchCount}
            </Button> : null}

            {!referenceSelectionState && !isGroup ? <ConnectionHandleDot side="left" visible={hovered || isSelected || isConnecting} onMouseDown={(event) => onConnectStart(event, data.id, "target")} /> : null}
            {!referenceSelectionState && (definition?.hasSourceHandle ?? true) && data.type !== CanvasNodeType.Config ? <ConnectionHandleDot side="right" visible={hovered || isSelected || isConnecting} onMouseDown={(event) => onConnectStart(event, data.id, "source")} /> : null}

            {/* Counter-scale the panel so its on-screen size stays constant while the canvas zooms. */}
            {showPanel && !isGroup && renderPanel ? (
                <div className="absolute left-1/2 top-full z-[70] w-[624px] max-w-[calc(100vw-2rem)] pt-2" style={{ transform: `translateX(-50%) scale(${1 / scale})`, transformOrigin: "top center" }} data-node-panel={data.id}>
                    {renderPanel(data)}
                </div>
            ) : null}
        </div>
        {isEditingTitle ? <Dialog open title={t("canvas.project.rename")} onClose={() => setIsEditingTitle(false)} onConfirm={finishTitleEditing} confirmDisabled={!titleDraft.trim()} dirty={titleDraft !== initialTitle.current} width={448}>
            <Input autoFocus value={titleDraft} maxLength={64} aria-label={t("workspace.name")} onFocus={(event) => event.target.select()} onChange={(event) => setTitleDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing && titleDraft.trim()) { event.preventDefault(); finishTitleEditing(); } }} />
        </Dialog> : null}
        </>
    );
});

function NodeContent(props: NodeContentRendererProps) {
    if (!isNodeTypeEnabled(props.node.type)) return <MissingPluginContent theme={props.theme} type={props.node.type} />;
    const definition = getNodeDefinition(props.node.type);
    if (!definition?.builtinRenderer) {
        if (!definition?.Content || !props.pluginContext) return <MissingPluginContent theme={props.theme} type={props.node.type} />;
        return <PluginContentBoundary content={definition.Content} ctx={props.pluginContext} />;
    }
    if (props.node.type === CanvasNodeType.Config && props.renderNodeContent) return props.renderNodeContent(props.node);
    if (props.isBatchRoot && props.node.type === CanvasNodeType.Image) return <ImageNodeContent {...props} />;
    if (props.node.type === CanvasNodeType.Text && props.node.metadata?.texts?.length && (props.node.metadata.status !== "error" || props.node.metadata.texts.some((text) => text.content))) return <TextContent {...props} />;
    if (props.node.type !== CanvasNodeType.Text && props.node.metadata?.status === "loading") return <LoadingContent node={props.node} theme={props.theme} />;
    if (props.node.metadata?.status === "error") return <ErrorContent node={props.node} theme={props.theme} onRetry={props.onRetry} />;

    const Renderer = nodeContentRenderers[props.node.type as CanvasNodeType];
    if (Renderer) return <Renderer {...props} />;

    return <MissingPluginContent theme={props.theme} type={props.node.type} />;
}

type PluginContentBoundaryProps = { content: NonNullable<import("@/types/canvas-plugin").CanvasNodeDefinition["Content"]>; ctx: CanvasNodeContext };
class PluginContentBoundary extends React.Component<PluginContentBoundaryProps, { failed: boolean }> {
    state = { failed: false };
    static getDerivedStateFromError() { return { failed: true }; }
    componentDidUpdate(previous: Readonly<PluginContentBoundaryProps>) {
        if (this.state.failed && previous.content !== this.props.content) this.setState({ failed: false });
    }
    render() {
        if (this.state.failed) return <FailedPluginContent onRetry={() => this.setState({ failed: false })} />;
        const Content = this.props.content;
        return <Content ctx={this.props.ctx} />;
    }
}

function FailedPluginContent({ onRetry }: { onRetry: () => void }) {
    const { t } = useTranslation();
    return <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center text-sm text-muted-foreground"><p>{t("nodePlugins.renderFailed")}</p><Button variant="ghost" size="sm" onPointerDown={(event) => event.stopPropagation()} onClick={onRetry}>{t("workspace.retry")}</Button></div>;
}

const nodeContentRenderers = {
    [CanvasNodeType.Text]: TextContent,
    [CanvasNodeType.Image]: ImageNodeContent,
    [CanvasNodeType.Config]: EmptyImageContent,
    [CanvasNodeType.Video]: VideoNodeContent,
    [CanvasNodeType.Audio]: AudioNodeContent,
    [CanvasNodeType.Group]: () => null,
} satisfies Record<CanvasNodeType, (props: NodeContentRendererProps) => ReactNode>;

function CanvasGenerationProgress({ nodeId, slotId }: { nodeId: string; slotId?: string }) {
    const { id } = useParams();
    const progress = useCanvasGenerationProgress(id, nodeId, slotId);
    return <GenerationProgress task={progress} />;
}

function LoadingContent({ node, theme }: Pick<NodeContentRendererProps, "node" | "theme">) {
    return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3" style={{ color: theme.node.activeStroke }}>
            <CanvasGenerationProgress nodeId={node.id} />
        </div>
    );
}

function ErrorContent({ node, theme, onRetry }: Pick<NodeContentRendererProps, "node" | "theme" | "onRetry">) {
    const { t } = useTranslation();
    return (
        <div className="flex max-w-[260px] flex-col items-center gap-3 px-5 text-center">
            <div className="text-xs leading-5 text-destructive">{node.metadata?.errorDetails || t("canvas.node.failed")}</div>
            <button
                type="button"
                className="inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition hover:scale-[1.02]"
                style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
                onClick={(event) => {
                    event.stopPropagation();
                    onRetry?.(node);
                }}
                onMouseDown={(event) => event.stopPropagation()}
            >
                <RefreshCw className="size-3.5" />
                {t("canvas.node.retry")}
            </button>
        </div>
    );
}

function MissingPluginContent({ theme, type }: Pick<NodeContentRendererProps, "theme"> & { type: string }) {
    const { t } = useTranslation();
    return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center" style={{ color: theme.node.placeholder }}>
            <Puzzle className="size-7 opacity-40" />
            <span className="text-sm">{t("canvas.node.missingPlugin")}</span>
            <span className="text-xs opacity-70">{t("canvas.node.missingPluginDescription", { type })}</span>
        </div>
    );
}

function TextContent({ node, theme, isEditingContent, textareaRef, mentionReferences, onContentChange, onStopEditing }: NodeContentRendererProps) {
    const { t } = useTranslation();
    const { id } = useParams();
    const fontSize = node.metadata?.fontSize || 14;
    const textStyle = { fontSize: `${fontSize}px`, lineHeight: `${Math.round(fontSize * 1.65)}px`, color: theme.node.text, boxSizing: "border-box" } as React.CSSProperties;
    const texts = node.metadata?.texts || [];
    const primaryTextId = node.metadata?.primaryTextId || texts[0]?.id;
    const primaryText = texts.find((text) => text.id === primaryTextId);
    const liveText = useGenerationProgressStore((state) => canvasGenerationTask(state, id, node.id, primaryTextId)?.text);
    const content = (primaryText?.status || node.metadata?.status) === "loading" ? liveText || primaryText?.content || node.metadata?.content || "" : primaryText?.content ?? node.metadata?.content ?? "";

    return (
            <div className="flex h-full w-full flex-col overflow-hidden rounded-xl">
                {isEditingContent ? (
                    <CanvasResourceMentionTextarea
                        ref={textareaRef}
                        className="thin-scrollbar m-0 block h-full w-full resize-none appearance-none overflow-y-auto whitespace-pre-wrap break-words border-none bg-transparent p-4 font-mono outline-none select-text"
                        style={textStyle}
                        value={content}
                        references={mentionReferences}
                        highlightLabels={false}
                        onChange={(value) => onContentChange(node.id, value)}
                        onBlur={onStopEditing}
                        onKeyDown={(event) => {
                            if (event.key === "Escape") onStopEditing();
                        }}
                        onMouseDown={(event) => event.stopPropagation()}
                        onPointerDown={(event) => event.stopPropagation()}
                        onWheel={(event) => event.stopPropagation()}
                    />
                ) : content ? (
                    <div className="thin-scrollbar block h-full w-full overflow-y-auto whitespace-pre-wrap break-words bg-transparent p-4 font-mono" style={textStyle} onWheel={(event) => event.stopPropagation()}>
                        {content}
                        {(primaryText?.status || node.metadata?.status) === "loading" ? <div className="mt-3"><CanvasGenerationProgress nodeId={node.id} slotId={primaryTextId} /></div> : null}
                    </div>
                ) : node.metadata?.status === "loading" && !primaryText ? (
                    <LoadingContent node={node} theme={theme} />
                ) : primaryText ? (
                    <TextSlotStatus nodeId={node.id} text={primaryText} />
                ) : (
                    <div className="p-4 font-mono" style={{ color: theme.node.placeholder }}>
                        {t("canvas.node.editText")}
                    </div>
                )}
            </div>
    );
}

function TextSlotStatus({ nodeId, text }: { nodeId: string; text: CanvasNodeText }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { t } = useTranslation();
    const failed = text.status === "error";
    const loading = text.status === "loading";
    return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-center" style={{ background: theme.node.fill, color: failed ? theme.node.text : theme.node.activeStroke }}>
            {failed ? <span className="text-xs leading-5">{text.errorDetails || t("canvas.node.failed")}</span> : loading ? <CanvasGenerationProgress nodeId={nodeId} slotId={text.id} /> : <span className="text-xs">{t("apiErrors.noContent")}</span>}
        </div>
    );
}

function ImageNodeContent(props: NodeContentRendererProps) {
    if (!props.node.metadata?.content && !props.isBatchRoot) return <EmptyImageContent {...props} />;

    return (
        <ImageContent
            node={props.node}
            scale={props.scale}
            onDownloadBatchImage={props.onDownloadBatchImage}
            onRetryBatchImage={props.onRetryBatchImage}
            onDeleteBatchImage={props.onDeleteBatchImage}
        />
    );
}

function EmptyImageContent({ theme }: NodeContentRendererProps) {
    const { t } = useTranslation();
    return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3" style={{ color: theme.node.placeholder }}>
            <ImageIcon className="size-6" style={{ color: theme.node.text }} />
            <span className="text-xs tracking-[0.18em] opacity-50">{t("canvas.node.emptyImage")}</span>
        </div>
    );
}

function VideoNodeContent({ node, theme }: NodeContentRendererProps) {
    const { t } = useTranslation();
    if (!node.metadata?.content)
        return (
            <div className="flex h-full w-full flex-col items-center justify-center gap-3" style={{ color: theme.node.placeholder }}>
                <Video className="size-7" style={{ color: theme.node.text }} />
                <span className="text-sm">{t("canvas.node.emptyVideo")}</span>
            </div>
        );
    return <AssetMedia kind="video" src={node.metadata.content} assetKey={node.metadata.storageKey} videoPreview className="h-full w-full rounded-xl object-contain" data-canvas-video={node.id} />;
}

function AudioNodeContent({ node, theme }: NodeContentRendererProps) {
    const { t } = useTranslation();
    if (!node.metadata?.content)
        return (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2" style={{ color: theme.node.placeholder }}>
                <Music2 className="size-7" style={{ color: theme.node.text }} />
                <span className="text-sm">{t("canvas.node.emptyAudio")}</span>
            </div>
        );
    return (
        <div className="flex h-full w-full flex-col justify-center gap-3 px-4" style={{ background: theme.node.fill, color: theme.node.text }}>
            <div className="flex min-w-0 items-center gap-2 text-sm opacity-70">
                <Music2 className="size-4 shrink-0" />
                <span className="truncate">{t("canvas.node.audio")}</span>
            </div>
            <AssetMedia kind="audio" src={node.metadata.content} controls className="w-full" />
        </div>
    );
}

function ImageContent({
    node,
    scale,
    onDownloadBatchImage,
    onRetryBatchImage,
    onDeleteBatchImage,
}: {
    node: CanvasNodeData;
    scale: number;
    onDownloadBatchImage?: (imageId: string) => void;
    onRetryBatchImage?: (imageId: string) => void;
    onDeleteBatchImage?: (imageId: string) => void;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { t } = useTranslation();
    useSyncExternalStore(subscribeImagePreviews, getImagePreviewRevision);
    const images = node.metadata?.images || [];
    const primaryImageId = node.metadata?.primaryImageId || images[0]?.id;
    const primaryImage = images.find((image) => image.id === primaryImageId);
    const primaryContent = primaryImage?.content || node.metadata?.content;
    const primaryPreviewUrl = previewUrlFor(primaryImage?.storageKey || node.metadata?.storageKey);
    const primarySource = primaryContent
        ? pickImageSource({
              previewUrl: primaryPreviewUrl,
              originalUrl: primaryContent,
              naturalWidth: primaryImage?.naturalWidth || node.metadata?.naturalWidth,
              naturalHeight: primaryImage?.naturalHeight || node.metadata?.naturalHeight,
              renderedWidth: node.width,
              renderedHeight: node.height,
              scale,
          })
        : undefined;

    return (
        <>
            <div className="h-full w-full overflow-hidden rounded-xl">
                {primaryContent ? (
                    <AssetMedia
                        src={primarySource}
                        assetKey={primaryImage?.storageKey || node.metadata?.storageKey}
                        alt={node.title}
                        draggable={false}
                        onDragStart={(event) => event.preventDefault()}
                        className={`pointer-events-none block h-full w-full select-none ${node.metadata?.freeResize ? "object-fill" : "object-contain"}`}
                    />
                ) : (
                    <ImageSlotStatus nodeId={node.id} image={primaryImage} />
                )}
            </div>
            {primaryImage?.status === "error" ? <BatchImageFailureActions onRetry={() => onRetryBatchImage?.(primaryImage.id)} onDelete={() => onDeleteBatchImage?.(primaryImage.id)} /> : null}
            {primaryImage?.content ? (
                <Tooltip title={t("common.download")}><button type="button" className="pointer-events-none absolute left-2.5 top-2.5 z-30 flex h-8 items-center gap-1 rounded-lg border px-2 text-xs font-medium opacity-0 shadow-lg backdrop-blur-md transition hover:scale-[1.02] group-hover/node:pointer-events-auto group-hover/node:opacity-100" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.toolbar.activeText }} onClick={(event) => (event.stopPropagation(), onDownloadBatchImage?.(primaryImage.id))}>
                    <Download className="size-3" />
                    {t("common.download")}
                </button></Tooltip>
            ) : null}
        </>
    );
}

function BatchImageFailureActions({ onRetry, onDelete }: { onRetry: () => void; onDelete: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { t } = useTranslation();
    return (
        <div className="absolute left-3 top-3 z-30 flex items-center gap-1.5">
            <button type="button" className="flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium shadow-sm transition hover:scale-[1.02]" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }} onClick={(event) => (event.stopPropagation(), onRetry())}>
                <RefreshCw className="size-3.5" />
                {t("canvas.node.retry")}
            </button>
            <Button size="icon" className="rounded-lg shadow-sm [&_svg]:size-3.5" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }} onClick={(event) => (event.stopPropagation(), onDelete())} aria-label={t("common.delete")} title={t("common.delete")}>
                <Trash2 className="size-3.5" />
            </Button>
        </div>
    );
}

function ImageSlotStatus({ nodeId, image }: { nodeId: string; image?: CanvasNodeImage }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { t } = useTranslation();
    const failed = image?.status === "error";
    return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-center" style={{ background: theme.node.fill, color: failed ? theme.node.text : theme.node.activeStroke }}>
            {failed ? <span className="text-xs leading-5">{image.errorDetails || t("canvas.node.failed")}</span> : <CanvasGenerationProgress nodeId={nodeId} slotId={image?.id} />}
        </div>
    );
}

function MediaInfoBar({ node }: { node: CanvasNodeData }) {
    const { i18n } = useTranslation();
    const width = Math.round(node.metadata?.naturalWidth || 0);
    const height = Math.round(node.metadata?.naturalHeight || 0);
    const isVideo = node.type === CanvasNodeType.Video || node.type === UPSCALE_NODE_TYPE && upscaleResource(node)?.kind === "video";
    const durationMs = node.metadata?.durationMs || 0;
    const parameters = [
        width > 0 && height > 0 ? formatRatio(width, height) : "",
        isVideo && Number.isFinite(durationMs) && durationMs > 0 ? `${(durationMs / 1000).toLocaleString(i18n.resolvedLanguage, { maximumFractionDigits: 3 })}s` : "",
        formatBytes(node.metadata?.bytes || 0),
    ].filter(Boolean).join(" · ");
    if (!parameters) return null;
    return (
        <span className="ml-auto min-w-0 truncate text-right text-xs font-medium text-muted-foreground">{parameters}</span>
    );
}

function ResizeHandle({ corner, onMouseDown }: { corner: ResizeCorner; onMouseDown: (event: React.MouseEvent, corner: ResizeCorner) => void }) {
    const positionClass = {
        "top-left": "-left-[14px] -top-[14px] cursor-nwse-resize",
        "top-right": "-right-[14px] -top-[14px] cursor-nesw-resize",
        "bottom-left": "-bottom-[14px] -left-[14px] cursor-nesw-resize",
        "bottom-right": "-bottom-[14px] -right-[14px] cursor-nwse-resize",
    }[corner];

    return <div className={`absolute z-50 size-7 ${positionClass}`} onMouseDown={(event) => onMouseDown(event, corner)} />;
}

function ConnectionHandleDot({ side, visible, onMouseDown }: { side: "left" | "right"; visible: boolean; onMouseDown: (event: React.MouseEvent) => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    return (
        <div
            className={`absolute top-1/2 z-30 flex size-12 -translate-y-1/2 cursor-crosshair items-center justify-center transition-opacity duration-(--motion-fade-duration) ease-(--motion-fade-easing) ${
                side === "left" ? "-left-6" : "-right-6"
            } ${visible ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"}`}
            onMouseDown={onMouseDown}
        >
            <div className="size-3 rounded-full border-2 transition-all hover:scale-125" style={{ background: theme.node.panel, borderColor: theme.node.muted }} />
        </div>
    );
}
