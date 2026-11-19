import { CircleHelp, FileText, Image as ImageIcon, Music2, Plus, Puzzle, Video, X } from "lucide-react";
import { Menu, Popover, Tooltip } from "@/components/ui/popover";
import { useRef, useState, useSyncExternalStore } from "react";
import { Reorder, useDragControls } from "motion/react";
import { useMotionTokens, useShouldReduceMotion } from "@animate-ui/react/utils/motion";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

import { canvasThemes } from "@/lib/canvas-theme";
import { getNodeDefinition } from "@/lib/canvas/node-registry";
import { buildCanvasResourceReferences, resourceKind, type CanvasNodeReferenceEntry, type CanvasResourceKind } from "@/lib/canvas/canvas-resource-references";
import { getImagePreviewRevision, previewUrlFor, subscribeImagePreviews } from "@/services/image-storage";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import { cn } from "@/lib/utils";

export type CanvasReferenceSource = "library" | "canvas" | "upload";

export function CanvasNodeReferenceBar({ nodeId, entries, kinds, help, square = false, disabled = false, onDisconnect, onAdd, onReorder }: { nodeId: string; entries: CanvasNodeReferenceEntry[]; kinds?: CanvasResourceKind[]; help?: string; square?: boolean; disabled?: boolean; onDisconnect?: (fromNodeId: string, toNodeId: string) => void; onAdd?: (nodeId: string, source: CanvasReferenceSource) => void; onReorder?: (ids: string[]) => void }) {
    const { t } = useTranslation();
    const [draftOrder, setDraftOrder] = useState<string[] | null>(null);
    const [dragging, setDragging] = useState(false);
    const dragOrder = useRef<string[] | null>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const byId = new Map(entries.filter(({ node }) => !kinds || kinds.includes(resourceKind(node)!)).map((entry) => [entry.node.id, entry]));
    const ids = [...new Set([...(draftOrder || []), ...byId.keys()])].filter((id) => byId.has(id));
    const references = buildCanvasResourceReferences(ids.map((id) => byId.get(id)!.node));
    const reorderable = Boolean(onReorder && !disabled && ids.length > 1);
    const previewOrder = (next: string[]) => { dragOrder.current = next; setDraftOrder(next); };
    const commitOrder = () => {
        if (!disabled && dragOrder.current) onReorder?.(dragOrder.current);
        dragOrder.current = null;
        setDraftOrder(null);
        setDragging(false);
    };
    const moveReference = (index: number, direction: number) => {
        const target = index + direction;
        if (target < 0 || target >= ids.length) return;
        const next = [...ids];
        next.splice(target, 0, next.splice(index, 1)[0]);
        onReorder?.(next);
    };
    const title = t(kinds?.length === 1 && kinds[0] === "text" ? "canvas.references.textTitle" : "canvas.references.title");
    const addLabel = t("canvas.references.add");
    const items = references.map((reference, index) => {
        const { node, sourceNodeId } = byId.get(reference.nodeId)!;
        return <ReferenceItem key={node.id} node={node} label={reference.label} square={square} reorderable={reorderable} dragging={dragging} onOrderStart={() => { dragOrder.current = ids; setDragging(true); }} onOrderEnd={commitOrder} onMove={(direction) => moveReference(index, direction)} onDragScroll={(pageX) => {
            const container = scrollRef.current;
            if (!container) return;
            const bounds = container.getBoundingClientRect(), pointerX = pageX - window.scrollX;
            container.scrollLeft += pointerX < bounds.left + 24 ? -8 : pointerX > bounds.right - 24 ? 8 : 0;
        }} onRemove={onDisconnect && !disabled && sourceNodeId !== nodeId ? () => onDisconnect(sourceNodeId, nodeId) : undefined} />;
    });
    const list = items.length ? <Reorder.Group as="div" ref={scrollRef} axis="x" layoutScroll values={ids} onReorder={previewOrder} className={cn("thin-scrollbar relative flex min-w-0 gap-2 overflow-x-auto overflow-y-hidden", square ? "-my-0.5 p-0.5" : "mt-1.5 pb-1")}>{items}</Reorder.Group> : null;
    if (square) return (
        <div role="group" aria-label={title} className="flex min-w-0 flex-1 items-start gap-2">
            {list}
            {onAdd ? <Menu disabled={disabled} placement="bottomLeft" items={(["library", "canvas", "upload"] as const).map((source) => ({ key: source, label: t(`canvas.references.sources.${source}`), onClick: () => onAdd(nodeId, source) }))}>
                <Button size="icon" className="size-14 rounded-lg bg-muted/40 text-muted-foreground [&_svg]:size-5" icon={<Plus />} title={addLabel} aria-label={addLabel} />
            </Menu> : null}
        </div>
    );
    return (
        <div>
            <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">{title}{help ? <Tooltip title={help} clickable placement="top"><Button variant="ghost" size="icon" className="size-5 [&_svg]:size-3.5" aria-label={t("ui.parameterHelp", { name: title })}><CircleHelp /></Button></Tooltip> : null}</span>
                {onAdd ? <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" disabled={disabled} icon={<Plus className="size-3.5" />} title={t("canvas.references.select")} onClick={() => onAdd(nodeId, "canvas")}>{addLabel}</Button> : null}
            </div>
            {list}
        </div>
    );
}

function ReferenceItem({ node, label, square, reorderable, dragging, onOrderStart, onOrderEnd, onMove, onDragScroll, onRemove }: { node: CanvasNodeData; label: string; square: boolean; reorderable: boolean; dragging: boolean; onOrderStart: () => void; onOrderEnd: () => void; onMove: (direction: number) => void; onDragScroll: (pageX: number) => void; onRemove?: () => void }) {
    const { t } = useTranslation();
    const controls = useDragControls();
    const tokens = useMotionTokens();
    const reducedMotion = useShouldReduceMotion();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    useSyncExternalStore(subscribeImagePreviews, getImagePreviewRevision);
    const resource = getNodeDefinition(node.type)?.resource?.(node);
    const content = node.metadata?.content || resource?.url;
    const thumbnail = previewUrlFor(node.metadata?.storageKey) || content;
    const Icon = resource?.kind === "image" || node.type === CanvasNodeType.Image ? ImageIcon : resource?.kind === "video" || node.type === CanvasNodeType.Video ? Video : resource?.kind === "audio" || node.type === CanvasNodeType.Audio ? Music2 : resource?.kind === "text" || node.type === CanvasNodeType.Text ? FileText : Puzzle;
    return (
        <Reorder.Item as="div" value={node.id} tabIndex={-1} drag={reorderable ? "x" : false} dragListener={false} dragControls={controls} onDragStart={onOrderStart} onDragEnd={onOrderEnd} onDrag={(_, info) => onDragScroll(info.point.x)} transition={reducedMotion ? tokens.transition.instant : tokens.spring.reflow} className="relative shrink-0">
        <Popover open={dragging ? false : undefined} placement="topLeft" content={<ReferencePreview node={node} content={content} />}>
            <div tabIndex={0} aria-label={`${label}: ${node.title}`} aria-description={reorderable ? t("canvas.references.reorder") : undefined} aria-keyshortcuts={reorderable ? "Alt+ArrowLeft Alt+ArrowRight" : undefined} onPointerDown={(event) => { if (reorderable && event.button === 0 && !(event.target as HTMLElement).closest("button")) controls.start(event); }} onKeyDown={(event) => { if (reorderable && event.target === event.currentTarget && event.altKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) { event.preventDefault(); event.stopPropagation(); onMove(event.key === "ArrowLeft" ? -1 : 1); } }} onFocus={(event) => event.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest" })} className={cn("group relative flex w-14 shrink-0 select-none flex-col overflow-hidden rounded-lg border outline-none focus-visible:ring-2 focus-visible:ring-ring", square && "h-14", reorderable && "touch-none cursor-grab active:cursor-grabbing")} style={{ borderColor: theme.toolbar.border }}>
                <span className={cn("grid w-full place-items-center overflow-hidden", square ? "absolute inset-0" : "h-12")}>
                    {(resource?.kind === "image" || node.type === CanvasNodeType.Image) && thumbnail ? <img src={thumbnail} alt="" draggable={false} className="size-full object-cover" /> : (resource?.kind === "video" || node.type === CanvasNodeType.Video) && content ? <video src={content} draggable={false} className="size-full object-cover" muted /> : <Icon className={cn("size-4 opacity-65", square && "-translate-y-2")} />}
                </span>
                <span className={cn("w-full truncate px-1 py-0.5 text-center text-xs text-muted-foreground", square && "relative mt-auto bg-background/90")}>{label}</span>
                {onRemove ? <Button size="icon" className="absolute right-0 top-0 size-5 rounded-full opacity-0 shadow-sm group-hover:opacity-100 focus-visible:opacity-100 [&_svg]:size-3" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border }} aria-label={t("canvas.references.disconnect")} title={t("canvas.references.disconnect")} onPointerDown={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onRemove(); }}><X /></Button> : null}
            </div>
        </Popover>
        </Reorder.Item>
    );
}

function ReferencePreview({ node, content }: { node: CanvasNodeData; content?: string }) {
    const { t } = useTranslation();
    const resource = getNodeDefinition(node.type)?.resource?.(node);
    if ((resource?.kind === "image" || node.type === CanvasNodeType.Image) && content) return <img src={content} alt={node.title} className="max-h-52 w-72 rounded-lg object-contain" />;
    if ((resource?.kind === "video" || node.type === CanvasNodeType.Video) && content) return <video src={content} className="max-h-52 w-72 rounded-lg" muted controls />;
    if ((resource?.kind === "audio" || node.type === CanvasNodeType.Audio) && content) return <audio src={content} className="w-72" controls />;
    return <div className="max-h-52 w-72 overflow-auto whitespace-pre-wrap text-sm">{resource?.text || node.metadata?.content || node.metadata?.prompt || node.title || t("canvas.references.empty")}</div>;
}
