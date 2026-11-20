import { useTranslation } from "react-i18next";
import appI18n from "@/i18n";
import { useEffect, useState, type ComponentProps } from "react";

import { assetId, getAsset } from "@/services/api/assets";
import { previewUrlFor } from "@/services/image-storage";
import { CanvasVideoPlayer } from "./canvas-video-player";

type Props = Omit<ComponentProps<"img">, "src"> & { src?: string; assetKey?: string; kind?: "image" | "video" | "audio"; controls?: boolean; videoPreview?: boolean; "data-canvas-video"?: string };

export function AssetMedia({ src, assetKey, kind = "image", controls, videoPreview, ...props }: Props) {
    useTranslation();
    const [deleted, setDeleted] = useState(false);
    const [failed, setFailed] = useState(false);
    const [original, setOriginal] = useState(false);
    const id = assetId(assetKey) || assetId(src);
    useEffect(() => {
        setDeleted(false); setFailed(false); setOriginal(false);
        const onDeleted = (event: Event) => { if ((event as CustomEvent<string>).detail === id) setDeleted(true); };
        window.addEventListener("asset-deleted", onDeleted);
        return () => window.removeEventListener("asset-deleted", onDeleted);
    }, [id, src]);
    const onError = () => {
        if (!id) { setFailed(true); return; }
        if (!original && src?.endsWith("/preview")) { setOriginal(true); return; }
        void getAsset(id).then((asset) => { setDeleted(Boolean(asset.deleteState)); setFailed(!asset.deleteState); }).catch(() => setFailed(true));
    };
    const placeholder = src?.startsWith("deleted-asset:") || assetKey?.startsWith("deleted-asset:");
    if (placeholder || deleted || failed) return <div className="flex h-full min-h-24 w-full items-center justify-center text-center text-xs text-muted-foreground">{placeholder || deleted ? appI18n.t("workspace.assetDeleted") : appI18n.t("workspace.assetUnavailable")}</div>;
    if (kind === "video" && videoPreview) return <CanvasVideoPlayer key={src} src={src} poster={previewUrlFor(assetKey) || previewUrlFor(src)} nodeId={props["data-canvas-video"]} className={props.className} onError={onError} />;
    if (kind === "video") return <video src={src} controls={controls} preload="none" className={props.className} onError={onError} data-canvas-video={props["data-canvas-video"]} data-canvas-no-zoom />;
    if (kind === "audio") return <audio src={src} controls={controls} preload="none" className={props.className} onError={onError} data-canvas-no-zoom />;
    return <img {...props} src={original && id ? `/api/assets/${encodeURIComponent(id)}/file` : src} loading="lazy" onError={onError} />;
}
