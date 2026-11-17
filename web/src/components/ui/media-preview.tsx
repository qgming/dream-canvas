import { useState, type CSSProperties } from "react";
import { ZoomIn, ZoomOut, RotateCw, Download } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Dialog } from "./dialog";
import { Button } from "./button";

export function MediaPreview({ src, alt, className, style, previewSrc, open: controlled, onOpenChange }: { src: string; alt: string; className?: string; style?: CSSProperties; previewSrc?: string; open?: boolean; onOpenChange?: (value: boolean) => void }) {
    const [opened, setOpened] = useState(false);
    const [scale, setScale] = useState(1);
    const [rotation, setRotation] = useState(0);
    const { t } = useTranslation();
    const change = (next: boolean) => { setOpened(next); onOpenChange?.(next); if (!next) { setScale(1); setRotation(0); } };
    return <><button type="button" style={style} className="block w-full cursor-zoom-in" onClick={() => change(true)} aria-label={alt}><img src={src} alt={alt} className={className} loading="lazy" /></button><Dialog open={controlled ?? opened} title={alt} onClose={() => change(false)} width="calc(100vw - 64px)" footer={<><Button variant="ghost" size="icon" aria-label={t("ui.zoomOut")} onClick={() => setScale(Math.max(0.25, scale - 0.25))}><ZoomOut /></Button><Button variant="ghost" size="icon" aria-label={t("ui.zoomIn")} onClick={() => setScale(scale + 0.25)}><ZoomIn /></Button><Button variant="ghost" size="icon" aria-label={t("ui.rotate")} onClick={() => setRotation(rotation + 90)}><RotateCw /></Button><Button asChild><a href={previewSrc || src} download><Download />{t("common.download")}</a></Button></>}><div className="flex min-h-[50dvh] items-center justify-center overflow-auto"><img src={previewSrc || src} alt={alt} className="max-h-[65dvh] max-w-full object-contain" style={{ transform: `scale(${scale}) rotate(${rotation}deg)` }} /></div></Dialog></>;
}
