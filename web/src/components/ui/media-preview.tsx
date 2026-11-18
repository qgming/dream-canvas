import { useState, type CSSProperties } from "react";
import { ZoomIn, ZoomOut, RotateCw, Download, ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Dialog } from "./dialog";
import { Button } from "./button";
import { cn } from "@/lib/utils";

export type PreviewImage = { src: string; alt: string };

export function MediaPreview({ src, alt, className, triggerClassName, style, previewSrc, gallery, open: controlled, onOpenChange }: { src: string; alt: string; className?: string; triggerClassName?: string; style?: CSSProperties; previewSrc?: string; gallery?: PreviewImage[]; open?: boolean; onOpenChange?: (value: boolean) => void }) {
    const [opened, setOpened] = useState(false);
    const [scale, setScale] = useState(1);
    const [rotation, setRotation] = useState(0);
    const [activeSrc, setActiveSrc] = useState<string>();
    const { t } = useTranslation();
    const index = Math.max(0, gallery?.findIndex((image) => image.src === (activeSrc || previewSrc || src)) ?? 0);
    const current = gallery?.[index];
    const resetView = () => { setScale(1); setRotation(0); };
    const change = (next: boolean) => { if (next) setActiveSrc(previewSrc || src); setOpened(next); onOpenChange?.(next); resetView(); };
    const move = (offset: number) => { const next = gallery?.[index + offset]; if (!next) return; setActiveSrc(next.src); resetView(); };
    return <>
        <button type="button" style={style} className={cn("block w-full cursor-zoom-in outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring", triggerClassName)} onClick={() => change(true)} aria-label={alt}><img src={src} alt={alt} className={className} loading="lazy" /></button>
        <Dialog open={controlled ?? opened} title={current?.alt || alt} onClose={() => change(false)} width="calc(100vw - 64px)" footer={<>
            {gallery && gallery.length > 1 ? <div className="flex items-center gap-2">
                <Button variant="ghost" size="icon" aria-label={t("ui.previousImage")} disabled={index === 0} onClick={() => move(-1)}><ChevronLeft /></Button>
                <span aria-live="polite" className="text-xs tabular-nums text-muted-foreground">{index + 1} / {gallery.length}</span>
                <Button variant="ghost" size="icon" aria-label={t("ui.nextImage")} disabled={index === gallery.length - 1} onClick={() => move(1)}><ChevronRight /></Button>
            </div> : null}
            <Button variant="ghost" size="icon" aria-label={t("ui.zoomOut")} onClick={() => setScale(Math.max(0.25, scale - 0.25))}><ZoomOut /></Button>
            <Button variant="ghost" size="icon" aria-label={t("ui.zoomIn")} onClick={() => setScale(scale + 0.25)}><ZoomIn /></Button>
            <Button variant="ghost" size="icon" aria-label={t("ui.rotate")} onClick={() => setRotation(rotation + 90)}><RotateCw /></Button>
            <Button asChild><a href={current?.src || previewSrc || src} download><Download />{t("common.download")}</a></Button>
        </>}>
            <div className="flex min-h-[50dvh] items-center justify-center overflow-auto"><img src={current?.src || previewSrc || src} alt={current?.alt || alt} className="max-h-[65dvh] max-w-full object-contain" style={{ transform: `scale(${scale}) rotate(${rotation}deg)` }} /></div>
        </Dialog>
    </>;
}
