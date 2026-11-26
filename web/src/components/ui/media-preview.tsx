import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent, type WheelEvent } from "react";
import { ZoomIn, ZoomOut, RotateCw, RotateCcw, ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Dialog } from "./dialog";
import { Button } from "./button";
import { cn } from "@/lib/utils";

export type PreviewImage = { src: string; alt: string };

const MIN_SCALE = 0.25;
const MAX_SCALE = 5;
const STEP_SCALE = 0.25;
const WHEEL_FACTOR = 1.15;

function clampScale(value: number) {
    return Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(value * 100) / 100));
}

export function MediaPreview({ src, alt, className, triggerClassName, style, previewSrc, gallery, open: controlled, onOpenChange }: { src: string; alt: string; className?: string; triggerClassName?: string; style?: CSSProperties; previewSrc?: string; gallery?: PreviewImage[]; open?: boolean; onOpenChange?: (value: boolean) => void }) {
    const [opened, setOpened] = useState(false);
    const [scale, setScale] = useState(1);
    const [rotation, setRotation] = useState(0);
    const [offset, setOffset] = useState({ x: 0, y: 0 });
    const [dragging, setDragging] = useState(false);
    const [activeSrc, setActiveSrc] = useState<string>();
    const dragRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null);
    const { t } = useTranslation();
    const isOpen = controlled ?? opened;
    const index = Math.max(0, gallery?.findIndex((image) => image.src === (activeSrc || previewSrc || src)) ?? 0);
    const current = gallery?.[index];
    const galleryLength = gallery?.length ?? 0;

    const resetView = useCallback(() => {
        setScale(1);
        setRotation(0);
        setOffset({ x: 0, y: 0 });
        dragRef.current = null;
        setDragging(false);
    }, []);

    useEffect(() => {
        if (isOpen) {
            setActiveSrc(previewSrc || src);
            resetView();
        }
    }, [isOpen, previewSrc, resetView, src]);

    const updateScale = useCallback((compute: (prev: number) => number) => {
        setScale((prev) => {
            const next = clampScale(compute(prev));
            if (next <= 1) {
                setOffset({ x: 0, y: 0 });
                dragRef.current = null;
                setDragging(false);
            }
            return next;
        });
    }, []);

    const change = useCallback((next: boolean) => {
        if (next) setActiveSrc(previewSrc || src);
        setOpened(next);
        onOpenChange?.(next);
        resetView();
    }, [onOpenChange, previewSrc, resetView, src]);

    const move = useCallback((delta: number) => {
        const next = gallery?.[index + delta];
        if (!next) return;
        setActiveSrc(next.src);
        resetView();
    }, [gallery, index, resetView]);

    useEffect(() => {
        if (!isOpen) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.metaKey || event.ctrlKey || event.altKey) return;
            const target = event.target as HTMLElement | null;
            if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) return;
            if (event.key === "ArrowLeft" && galleryLength > 1) {
                event.preventDefault();
                event.stopPropagation();
                move(-1);
                return;
            }
            if (event.key === "ArrowRight" && galleryLength > 1) {
                event.preventDefault();
                event.stopPropagation();
                move(1);
                return;
            }
            if (event.key === "+" || event.key === "=") {
                event.preventDefault();
                event.stopPropagation();
                updateScale((prev) => prev + STEP_SCALE);
                return;
            }
            if (event.key === "-") {
                event.preventDefault();
                event.stopPropagation();
                updateScale((prev) => prev - STEP_SCALE);
                return;
            }
            if (event.key === "0") {
                event.preventDefault();
                event.stopPropagation();
                resetView();
                return;
            }
            if (event.key === "r" || event.key === "R") {
                event.preventDefault();
                event.stopPropagation();
                setRotation((prev) => prev + 90);
            }
        };
        window.addEventListener("keydown", onKeyDown, true);
        return () => window.removeEventListener("keydown", onKeyDown, true);
    }, [galleryLength, isOpen, move, resetView, updateScale]);

    const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
        if (!event.deltaY) return;
        event.preventDefault();
        event.stopPropagation();
        const factor = event.deltaY < 0 ? WHEEL_FACTOR : 1 / WHEEL_FACTOR;
        const next = clampScale(scale * factor);
        if (next === scale) return;
        if (next <= 1) {
            setOffset({ x: 0, y: 0 });
            dragRef.current = null;
            setDragging(false);
        } else {
            const rect = event.currentTarget.getBoundingClientRect();
            const cx = event.clientX - (rect.left + rect.width / 2);
            const cy = event.clientY - (rect.top + rect.height / 2);
            const ratio = next / scale;
            setOffset((curr) => ({
                x: cx - (cx - curr.x) * ratio,
                y: cy - (cy - curr.y) * ratio,
            }));
        }
        setScale(next);
    };

    const canPan = scale > 1;
    const isTransformed = scale !== 1 || rotation % 360 !== 0 || offset.x !== 0 || offset.y !== 0;

    const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
        if (!canPan || event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, originX: offset.x, originY: offset.y };
        setDragging(true);
    };

    const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        setOffset({ x: drag.originX + (event.clientX - drag.startX), y: drag.originY + (event.clientY - drag.startY) });
    };

    const endDrag = (event: PointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        dragRef.current = null;
        setDragging(false);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    };

    return <>
        <button type="button" style={style} className={cn("block w-full cursor-zoom-in outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring", triggerClassName)} onClick={() => change(true)} aria-label={alt}><img src={src} alt={alt} className={className} loading="lazy" /></button>
        <Dialog open={isOpen} title={current?.alt || alt} onClose={() => change(false)} width="fit-content" headerActions={<>
            {gallery && gallery.length > 1 ? <div className="flex items-center gap-2">
                <Button variant="ghost" size="icon" title={t("ui.previousImage")} aria-label={t("ui.previousImage")} disabled={index === 0} onClick={() => move(-1)}><ChevronLeft /></Button>
                <span aria-live="polite" className="text-xs tabular-nums text-muted-foreground">{index + 1} / {gallery.length}</span>
                <Button variant="ghost" size="icon" title={t("ui.nextImage")} aria-label={t("ui.nextImage")} disabled={index === gallery.length - 1} onClick={() => move(1)}><ChevronRight /></Button>
            </div> : null}
            <Button variant="ghost" size="icon" title={t("ui.zoomOut")} aria-label={t("ui.zoomOut")} disabled={scale <= MIN_SCALE} onClick={() => updateScale((prev) => prev - STEP_SCALE)}><ZoomOut /></Button>
            <span aria-live="polite" className="min-w-10 text-center text-xs tabular-nums text-muted-foreground">{Math.round(scale * 100)}%</span>
            <Button variant="ghost" size="icon" title={t("ui.zoomIn")} aria-label={t("ui.zoomIn")} disabled={scale >= MAX_SCALE} onClick={() => updateScale((prev) => prev + STEP_SCALE)}><ZoomIn /></Button>
            <Button variant="ghost" size="icon" title={t("ui.rotate")} aria-label={t("ui.rotate")} onClick={() => setRotation((prev) => prev + 90)}><RotateCw /></Button>
            <Button variant="ghost" size="icon" title={t("ui.resetView")} aria-label={t("ui.resetView")} disabled={!isTransformed} onClick={resetView}><RotateCcw /></Button>
        </>}>
            <div
                data-canvas-no-zoom
                data-canvas-shortcuts-ignore
                className={cn("flex select-none items-center justify-center overflow-hidden touch-none", canPan && (dragging ? "cursor-grabbing" : "cursor-grab"))}
                onWheel={handleWheel}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
            >
                <img
                    src={current?.src || previewSrc || src}
                    alt={current?.alt || alt}
                    draggable={false}
                    className="block max-h-[65dvh] max-w-[calc(100vw-66px)] object-contain"
                    style={{ transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${scale}) rotate(${rotation}deg)` }}
                />
            </div>
        </Dialog>
    </>;
}
