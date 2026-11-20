import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useFeedback } from "@/hooks/use-feedback";
import { Dialog } from "@/components/ui/dialog";
import { Segmented } from "@/components/ui/controls";
import { Popover } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Download, Ellipsis, FolderPlus, Image as ImageIcon, Info, Mic, Minus, Music2, Plus, RefreshCw, Trash2, Ungroup, Upload, Video } from "lucide-react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { getNodeDefinition } from "@/lib/canvas/node-registry";
import { UPSCALE_NODE_TYPE } from "@/lib/canvas/canvas-upscale";
import { nodeResults } from "@/lib/canvas/canvas-node-results";
import { formatBytes, getDataUrlByteSize } from "@/lib/image-utils";
import { useCopyText } from "@/hooks/use-copy-text";
import { useNodeToolbarStore, type NodeToolbarConfig } from "@/stores/canvas/use-node-toolbar-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType, type CanvasNodeData, type ViewportTransform } from "@/types/canvas";
import type { CanvasNodeToolbarItem } from "@/types/canvas-plugin";
import { NodeToolbarSettingsModal } from "./canvas-node-toolbar-settings-modal";
import { buildImageToolbarTools, imageToolDefinitions } from "./canvas-image-toolbar-tools";

type CanvasNodeHoverToolbarProps = {
    node: CanvasNodeData | null;
    viewport: ViewportTransform;
    onKeep: (nodeId: string) => void;
    onLeave: () => void;
    onInfo: (node: CanvasNodeData) => void;
    onDecreaseFont: (node: CanvasNodeData) => void;
    onIncreaseFont: (node: CanvasNodeData) => void;
    onGenerateImage: (node: CanvasNodeData) => void;
    onUpload: (node: CanvasNodeData) => void;
    onRecordAudio: (node: CanvasNodeData) => void;
    onDownload: (node: CanvasNodeData) => void;
    onSaveAsset: (node: CanvasNodeData) => void;
    onMaskEdit: (node: CanvasNodeData) => void;
    onCrop: (node: CanvasNodeData) => void;
    onSplit: (node: CanvasNodeData) => void;
    onUpscale: (node: CanvasNodeData) => void;
    onAngle: (node: CanvasNodeData) => void;
    onViewImage: (node: CanvasNodeData) => void;
    onReversePrompt: (node: CanvasNodeData) => void;
    onRetry: (node: CanvasNodeData) => void;
    onToggleFreeResize: (node: CanvasNodeData) => void;
    onDelete: (node: CanvasNodeData) => void;
    onUngroup?: (node: CanvasNodeData) => void;
    extraTools?: CanvasNodeToolbarItem[];
};

type ToolbarTool = CanvasNodeToolbarItem;

export function CanvasNodeHoverToolbar({
    node,
    viewport,
    onKeep,
    onLeave,
    onInfo,
    onDecreaseFont,
    onIncreaseFont,
    onGenerateImage,
    onUpload,
    onRecordAudio,
    onDownload,
    onSaveAsset,
    onMaskEdit,
    onCrop,
    onSplit,
    onUpscale,
    onAngle,
    onViewImage,
    onReversePrompt,
    onRetry,
    onToggleFreeResize,
    onDelete,
    onUngroup,
    extraTools = [],
}: CanvasNodeHoverToolbarProps) {
    const config = useNodeToolbarStore((state) => node ? state.configs[node.type] : undefined);
    const saveConfig = useNodeToolbarStore((state) => state.saveConfig);
    const [draftConfig, setDraftConfig] = useState<NodeToolbarConfig>({ hiddenIds: [], showLabels: false });
    const [toolSettingsOpen, setToolSettingsOpen] = useState(false);
    const { notify } = useFeedback();
    const { t } = useTranslation();
    const copyText = useCopyText();

    useEffect(() => {
        setToolSettingsOpen(false);
    }, [node?.id, node?.type]);

    if (!node) return null;

    const activeNode = node;
    const left = viewport.x + (node.position.x + node.width / 2) * viewport.k;
    const isImage = node.type === CanvasNodeType.Image;
    const isVideo = node.type === CanvasNodeType.Video;
    const isAudio = node.type === CanvasNodeType.Audio;
    const hasImage = isImage && Boolean(node.metadata?.content);
    const hasVideo = isVideo && Boolean(node.metadata?.content);
    const hasAudio = isAudio && Boolean(node.metadata?.content);
    const hasUpscale = node.type === UPSCALE_NODE_TYPE && Boolean(node.metadata?.content);
    const top = viewport.y + node.position.y * viewport.k - 8 - (hasImage || hasVideo || hasUpscale ? 28 * viewport.k : 0);
    const isText = node.type === CanvasNodeType.Text;
    const canRetry = node.metadata?.status === "error" && !(isVideo && Boolean(node.metadata?.videoTaskId) && !hasVideo);
    const canQueryVideoTask = isVideo && Boolean(node.metadata?.videoTaskId) && !hasVideo && node.metadata?.status !== "loading";
    const hiddenIds = config?.hiddenIds ?? (isImage ? imageToolDefinitions.filter((tool) => !tool.defaultVisible).map((tool) => tool.id) : []);
    const hiddenToolIds = new Set(hiddenIds);
    const showLabels = config?.showLabels ?? !isImage;
    const copyImagePrompt = (target: CanvasNodeData) => {
        const prompt = target.metadata?.prompt?.trim();
        if (!prompt) {
            notify.warning(t("canvas.nodeToolbar.noPrompt"));
            return;
        }
        copyText(prompt, t("common.promptCopied"));
    };
    const imageTools = buildImageToolbarTools(node, { onUpload, onToggleFreeResize, onMaskEdit, onCrop, onSplit, onUpscale, onAngle, onViewImage, onCopyPrompt: copyImagePrompt, onReversePrompt });

    function openToolSettings() {
        onKeep(activeNode.id);
        setDraftConfig({ hiddenIds: [...hiddenIds], showLabels });
        setToolSettingsOpen(true);
    }

    const baseToolbarTools: ToolbarTool[] = [
        { id: "info", title: t("canvas.nodeToolbar.infoTitle"), label: t("canvas.nodeToolbar.info"), icon: <Info className="size-4" />, onClick: () => onInfo(node) },
        ...(node.type === CanvasNodeType.Group && onUngroup ? [{ id: "ungroup", title: t("canvas.nodeToolbar.ungroupTitle"), label: t("canvas.nodeToolbar.ungroup"), icon: <Ungroup className="size-4" />, onClick: () => onUngroup(node) }] : []),
        { id: "delete", title: t("canvas.nodeToolbar.removeTitle"), label: t("common.delete"), icon: <Trash2 className="size-4" />, onClick: () => onDelete(node), danger: true },
    ];
    const nodeToolbarTools: ToolbarTool[] = [
        ...(canQueryVideoTask ? [{ id: "queryVideoTask", title: t("canvas.nodeToolbar.queryVideoTaskTitle"), label: t("canvas.nodeToolbar.queryVideoTask"), icon: <RefreshCw className="size-4" />, onClick: () => onRetry(node) }] : []),
        ...(canRetry ? [{ id: "retry", title: t("canvas.nodeToolbar.retryTitle"), label: t("canvas.node.retry"), icon: <RefreshCw className="size-4" />, onClick: () => onRetry(node) }] : []),
        ...(hasImage || hasVideo || hasUpscale || isText ? [{ id: "saveAsset", title: t("common.addToAssets"), label: t("canvas.nodeToolbar.saveAsset"), icon: <FolderPlus className="size-4" />, onClick: () => onSaveAsset(node) }] : []),
        ...(hasImage || hasVideo || hasAudio ? [{ id: "download", title: t(hasAudio ? "canvas.nodeToolbar.downloadAudio" : hasVideo ? "canvas.nodeToolbar.downloadVideo" : "canvas.nodeToolbar.downloadImage"), label: t("common.download"), icon: <Download className="size-4" />, onClick: () => onDownload(node) }] : []),
        ...(isText ? [{ id: "generateImage", title: t("canvas.node.generateImage"), label: t("canvas.node.generate"), icon: <ImageIcon className="size-4" />, onClick: () => onGenerateImage(node) }] : []),
        ...(isText ? [{ id: "decreaseFont", title: t("canvas.nodeToolbar.decreaseFont"), label: t("canvas.nodeToolbar.zoomOut"), icon: <Minus className="size-4" />, onClick: () => onDecreaseFont(node) }] : []),
        ...(isText ? [{ id: "increaseFont", title: t("canvas.nodeToolbar.increaseFont"), label: t("canvas.nodeToolbar.zoomIn"), icon: <Plus className="size-4" />, onClick: () => onIncreaseFont(node) }] : []),
        ...(isImage && !hasImage ? [{ id: "uploadImage", title: t("canvas.nodeToolbar.uploadImage"), label: t("canvas.nodeToolbar.uploadImage"), icon: <Upload className="size-4" />, onClick: () => onUpload(node) }] : []),
        ...(isVideo ? [{ id: "uploadVideo", title: t(hasVideo ? "canvas.nodeToolbar.replaceVideo" : "canvas.nodeToolbar.uploadVideo"), label: t(hasVideo ? "canvas.nodeToolbar.replaceVideo" : "canvas.nodeToolbar.uploadVideo"), icon: <Video className="size-4" />, onClick: () => onUpload(node) }] : []),
        ...(isAudio ? [{ id: "uploadAudio", title: t(hasAudio ? "canvas.nodeToolbar.replaceAudio" : "canvas.nodeToolbar.uploadAudio"), label: t(hasAudio ? "canvas.nodeToolbar.replaceAudio" : "canvas.nodeToolbar.uploadAudio"), icon: <Music2 className="size-4" />, onClick: () => onUpload(node) }] : []),
        ...(isAudio ? [{ id: "recordAudio", title: t("canvas.audioRecorder.title"), label: t("canvas.audioRecorder.title"), icon: <Mic className="size-4" />, onClick: () => onRecordAudio(node) }] : []),
        ...(hasImage ? imageTools : []),
    ];
    const selectableTools = [...baseToolbarTools, ...nodeToolbarTools, ...extraTools];
    const toolbarTools = selectableTools.filter((tool) => !hiddenToolIds.has(tool.id));

    const closeToolSettings = () => {
        setToolSettingsOpen(false);
        onLeave();
    };

    const saveToolSettings = () => {
        saveConfig(node.type, draftConfig);
        closeToolSettings();
    };

    return (
        <>
            <div
                className="absolute z-[70] flex -translate-x-1/2 -translate-y-full items-center gap-1 overflow-visible rounded-xl border border-border bg-popover p-1 text-sm text-popover-foreground shadow-lg"
                data-ui-overlay data-canvas-no-zoom data-canvas-shortcuts-ignore
                data-node-toolbar={node.id}
                style={{ left, top }}
                onMouseEnter={() => onKeep(node.id)}
                onMouseLeave={() => {
                    if (!toolSettingsOpen) onLeave();
                }}
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
            >
                {toolbarTools.map((tool) => (
                    <ToolbarAction key={tool.id} {...tool} showLabel={showLabels} />
                ))}
                <ToolbarAction id="more" title={t("canvas.toolbarSettings.customize")} label={t("canvas.toolbarSettings.customize")} icon={<Ellipsis className="size-4" />} active={toolSettingsOpen} onClick={openToolSettings} showLabel={false} />
            </div>
            <NodeToolbarSettingsModal
                open={toolSettingsOpen}
                tools={selectableTools}
                nodeIcon={getNodeDefinition(node.type)?.icon || <Info className="size-8" />}
                nodeLabel={getNodeDefinition(node.type)?.title || node.type}
                value={draftConfig}
                savedValue={{ hiddenIds, showLabels }}
                onChange={setDraftConfig}
                onCancel={closeToolSettings}
                onSave={saveToolSettings}
            />
        </>
    );
}

export function CanvasNodeInfoModal({ node, displayName, open, onClose }: { node: CanvasNodeData | null; displayName?: string; open: boolean; onClose: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { t } = useTranslation();
    const [view, setView] = useState<"info" | "json">("info");
    const imageBytes = node?.type === CanvasNodeType.Image && node.metadata?.content ? getDataUrlByteSize(node.metadata.content) : 0;
    const batchCount = node ? nodeResults(node).length : 0;
    const json = useMemo(() => {
        if (!node) return "";
        return JSON.stringify(
            node,
            (key, value) => {
                if (key === "content" && typeof value === "string" && value.startsWith("data:image/")) {
                    return "[base64 image]";
                }
                return value;
            },
            2,
        );
    }, [node]);

    useEffect(() => {
        if (open) setView("info");
    }, [node?.id, open]);

    const title = (
        <div className="flex items-center justify-between gap-4 pr-12">
            <span>{t("canvas.nodeToolbar.nodeInfo")}</span>
            <Segmented
                size="small"
                value={view}
                onChange={(value) => setView(value as "info" | "json")}
                options={[
                    { label: t("canvas.nodeToolbar.info"), value: "info" },
                    { label: "JSON", value: "json" },
                ]}
            />
        </div>
    );

    return (
        <Dialog className="canvas-node-info-modal" title={title} open={open && Boolean(node)} footer={null} onClose={onClose}>
            {node ? (
                <div className="h-[56vh] min-h-[360px] select-text text-sm" data-canvas-shortcuts-ignore>
                    {view === "info" ? (
                        <div className="thin-scrollbar h-full space-y-3 overflow-auto pr-1">
                            <InfoRow label="ID" value={node.id} />
                            <InfoRow label={t("canvas.nodeToolbar.name")} value={displayName || node.title || t("canvas.node.untitled")} />
                            <InfoRow label={t("canvas.nodeToolbar.type")} value={node.type === CanvasNodeType.Group ? t("canvas.node.group") : node.type === CanvasNodeType.Config ? t("canvas.configNode.title") : [CanvasNodeType.Image, CanvasNodeType.Video, CanvasNodeType.Audio, CanvasNodeType.Text].includes(node.type as CanvasNodeType) ? t(`assets.kinds.${node.type}`) : getNodeDefinition(node.type)?.title || node.type} />
                            <InfoRow label={t("canvas.nodeToolbar.size")} value={`${Math.round(node.width)} x ${Math.round(node.height)}`} />
                            <InfoRow label={t("canvas.nodeToolbar.position")} value={`${Math.round(node.position.x)}, ${Math.round(node.position.y)}`} />
                            <InfoRow label={t("canvas.nodeToolbar.status")} value={node.metadata?.status || "idle"} />
                            {batchCount > 1 ? <InfoRow label={t("canvas.results.title")} value={t("canvas.results.count", { count: batchCount })} /> : null}
                            {node.metadata?.prompt ? <InfoRow label={t("canvas.configNode.prompt")} value={node.metadata.prompt} /> : null}
                            {node.metadata?.videoTaskId ? <InfoRow label={t("canvas.nodeToolbar.videoTaskId")} value={node.metadata.videoTaskId} /> : null}
                            {imageBytes ? <InfoRow label={t("canvas.nodeToolbar.imageSize")} value={formatBytes(imageBytes)} /> : null}
                            {node.metadata?.errorDetails ? (
                                <div className="rounded-lg border p-3 text-destructive" style={{ borderColor: theme.node.stroke }}>
                                    {node.metadata.errorDetails}
                                </div>
                            ) : null}
                        </div>
                    ) : (
                        <pre className="thin-scrollbar h-full overflow-auto rounded-lg border p-3 text-xs leading-5" style={{ background: theme.node.fill, borderColor: theme.node.stroke, color: theme.node.text }}>
                            {json}
                        </pre>
                    )}
                </div>
            ) : null}
        </Dialog>
    );
}

function ToolbarAction({ title, label, icon, onClick, popover, showLabel, active = false, danger = false }: ToolbarTool & { showLabel: boolean }) {
    const hasText = showLabel && Boolean(label);
    const button = <Button variant="ghost" size={hasText ? "default" : "icon"} className={`h-8 rounded-lg ${hasText ? "gap-1.5 px-2" : ""} ${active ? "bg-accent" : ""}`} data-destructive={danger || undefined} icon={icon} onClick={onClick} title={title} aria-label={title}>{hasText ? label : null}</Button>;
    return popover ? <Popover trigger="click" placement="top" className="w-52 p-3" content={popover}>{button}</Popover> : button;
}

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
    return (
        <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-3">
            <span className="opacity-50">{label}</span>
            <span className="min-w-0 whitespace-pre-wrap break-words">{value}</span>
        </div>
    );
}
