import { CheckCircle2, Circle, Copy, Download, Maximize2, RefreshCw, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { GenerationProgress } from "@/components/generation-progress";
import { useCopyText } from "@/hooks/use-copy-text";
import { useDownloadMedia } from "@/hooks/use-download-media";
import { mediaResultKind, nodePrimaryResultId, nodeResults } from "@/lib/canvas/canvas-node-results";
import { formatBytes, formatRatio } from "@/lib/image-utils";
import { cn } from "@/lib/utils";
import { previewUrlFor } from "@/services/image-storage";
import { canvasGenerationProgress, canvasGenerationTask, useGenerationProgressStore } from "@/stores/use-generation-progress-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import { AssetMedia } from "./asset-media";

type Props = {
    node: CanvasNodeData | null;
    onClose: () => void;
    onSelect: (nodeId: string, resultId: string) => void;
    onViewImage: (node: CanvasNodeData, resultId: string) => void;
    onDuplicateImage: (node: CanvasNodeData, resultId: string) => void;
    onRetryImage: (node: CanvasNodeData, resultId: string) => void;
    onDeleteImage: (nodeId: string, resultId: string) => void;
};

export function CanvasNodeResultsDialog({ node, onClose, onSelect, onViewImage, onDuplicateImage, onRetryImage, onDeleteImage }: Props) {
    const { t, i18n } = useTranslation();
    const { id: projectId } = useParams();
    const copyText = useCopyText();
    const download = useDownloadMedia();
    const state = useGenerationProgressStore();
    const results = node ? nodeResults(node) : [];
    const primaryId = node ? nodePrimaryResultId(node) : undefined;

    return <Dialog open={Boolean(node)} title={<span className="flex items-center gap-2">{t("canvas.results.title")}<span className="text-xs font-normal text-muted-foreground">{t("canvas.results.count", { count: results.length })}</span></span>} onClose={onClose} footer={null} width={results.length > 2 ? 1080 : results.length > 1 ? 760 : 560}>
        <div className={cn("grid grid-cols-1 gap-3 sm:grid-cols-2", results.length > 2 && "lg:grid-cols-3", results.length === 1 && "sm:grid-cols-1")}>
            {node ? results.map((result, index) => {
                const media = "mimeType" in result ? result : undefined;
                const kind = media ? mediaResultKind(node, media) : "text";
                const selected = primaryId === result.id;
                const available = result.status === "success" && Boolean(result.content);
                const task = canvasGenerationTask(state, projectId, node.id, result.id);
                const progress = canvasGenerationProgress(state, projectId, node.id, result.id);
                const content = kind === "text" && result.status === "loading" ? task?.text || result.content : result.content;
                const label = t(selected ? "canvas.results.current" : "canvas.results.select", { index: index + 1 });
                const parameters = media ? [
                    media.naturalWidth > 0 && media.naturalHeight > 0 ? formatRatio(media.naturalWidth, media.naturalHeight) : "",
                    kind !== "image" && (media.durationMs || 0) > 0 ? `${(media.durationMs! / 1000).toLocaleString(i18n.resolvedLanguage, { maximumFractionDigits: 3 })}s` : "",
                    formatBytes(media.bytes),
                ].filter(Boolean).join(" · ") : "";
                const select = () => { if (available) onSelect(node.id, result.id); };
                const status = result.status === "loading" ? <GenerationProgress task={progress} /> : result.status === "error" ? <p role="alert" className="break-words text-xs leading-5 text-destructive">{result.errorDetails || t("canvas.node.failed")}</p> : !content ? <p className="text-xs text-muted-foreground">{t("apiErrors.noContent")}</p> : null;
                return <article key={result.id} className={cn("min-w-0 overflow-hidden rounded-xl border bg-card text-card-foreground", selected ? "border-primary ring-1 ring-primary" : "border-border")}>
                    {kind === "text" || kind === "image" ? <button type="button" disabled={!available} aria-label={label} aria-pressed={selected} className="relative block h-56 w-full text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-default" onClick={select}>
                        {content ? kind === "image" ? <AssetMedia src={previewUrlFor(media?.storageKey || content) || content} assetKey={media?.storageKey} alt={t("canvas.results.item", { index: index + 1 })} draggable={false} className="pointer-events-none size-full object-contain" /> : <div className="thin-scrollbar h-full overflow-y-auto whitespace-pre-wrap break-words p-3 text-sm leading-6">{content}{status ? <div className="mt-2">{status}</div> : null}</div> : <div className="grid size-full place-items-center p-3 text-center">{status}</div>}
                    </button> : <div className="flex h-56 items-center justify-center p-2" onClick={(event) => { if (!(event.target instanceof Element && event.target.closest("button, video[controls], audio"))) select(); }}>
                        {content ? <AssetMedia kind={kind} src={content} assetKey={media?.storageKey} videoPreview={kind === "video"} controls={kind === "audio"} className={kind === "audio" ? "w-full" : "h-full w-full object-contain"} /> : status}
                    </div>}
                    <div className="px-2 pb-2 pt-1">
                        {media && content && status ? <div className="px-1 pb-1">{status}</div> : null}
                        {parameters ? <p className="truncate px-1 text-xs leading-5 text-muted-foreground">{parameters}</p> : null}
                        <div className="flex min-w-0 items-center gap-1">
                            <Button variant="ghost" size="sm" className="min-w-0 flex-1 justify-start border-0 px-1" disabled={!available} title={label} aria-label={label} aria-pressed={selected} onClick={select} icon={selected ? <CheckCircle2 className="text-primary" /> : <Circle className="text-muted-foreground" />}><span className="truncate">{t("canvas.results.item", { index: index + 1 })}</span>{selected ? <span className="ml-1 text-xs text-primary">{t("canvas.results.primary")}</span> : null}</Button>
                            {content ? kind === "text" ? <Button size="icon" title={t("common.copy")} aria-label={t("common.copy")} icon={<Copy />} onClick={() => copyText(content)} /> : <>
                                {kind === "image" ? <Button size="icon" title={t("canvas.imageTools.viewTitle")} aria-label={t("canvas.imageTools.viewTitle")} icon={<Maximize2 />} onClick={() => onViewImage(node, result.id)} /> : null}
                                {node.type === CanvasNodeType.Image ? <Button size="icon" title={t("canvas.node.createCopy")} aria-label={t("canvas.node.createCopy")} icon={<Copy />} onClick={() => onDuplicateImage(node, result.id)} /> : null}
                                <Button size="icon" title={t("common.download")} aria-label={t("common.download")} icon={<Download />} onClick={() => void download({ url: content, storageKey: media?.storageKey, mimeType: media?.mimeType }, `canvas-${kind}-${node.id}-${result.id}`)} />
                            </> : null}
                            {node.type === CanvasNodeType.Image && result.status === "error" ? <>
                                <Button size="icon" title={t("canvas.node.retry")} aria-label={t("canvas.node.retry")} icon={<RefreshCw />} onClick={() => onRetryImage(node, result.id)} />
                                <Button size="icon" title={t("common.delete")} aria-label={t("common.delete")} icon={<Trash2 />} onClick={() => onDeleteImage(node.id, result.id)} />
                            </> : null}
                        </div>
                    </div>
                </article>;
            }) : null}
        </div>
    </Dialog>;
}
