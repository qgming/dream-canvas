import { useEffect, useMemo, useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Segmented } from "@/components/ui/controls";
import { useTranslation } from "react-i18next";

import { readImageMeta } from "@/lib/image-utils";
import { MAX_UPSCALE_LONG_EDGE, resolveUpscaleSize, type ImageUpscaleAlgorithm, type ImageUpscaleParams } from "@/lib/canvas/canvas-image-data";

export type CanvasImageUpscaleParams = ImageUpscaleParams;

const algorithms: ImageUpscaleAlgorithm[] = ["high", "bilinear", "nearest"];

const targetOptions = [
    { label: "1K", value: 1024 },
    { label: "2K", value: 2048 },
    { label: "4K", value: MAX_UPSCALE_LONG_EDGE },
];

const defaultParams: CanvasImageUpscaleParams = {
    targetLongEdge: 2048,
    algorithm: "high",
};

export function CanvasNodeUpscaleDialog({ dataUrl, open, onClose, onConfirm }: { dataUrl: string; open: boolean; onClose: () => void; onConfirm: (params: CanvasImageUpscaleParams) => void | Promise<unknown> }) {
    const { t } = useTranslation();
    const [params, setParams] = useState<CanvasImageUpscaleParams>(defaultParams);
    const [initialParams, setInitialParams] = useState(defaultParams);
    const [readError, setReadError] = useState("");
    const [image, setImage] = useState<{ width: number; height: number } | null>(null);
    const sourceLongEdge = image ? Math.max(image.width, image.height) : 0;
    const outputSize = useMemo(() => (image ? resolveUpscaleSize(image.width, image.height, params.targetLongEdge) : null), [image, params.targetLongEdge]);
    const canUpscale = Boolean(image && sourceLongEdge < params.targetLongEdge && params.targetLongEdge <= MAX_UPSCALE_LONG_EDGE);
    const reachedMax = Boolean(image && sourceLongEdge >= MAX_UPSCALE_LONG_EDGE);

    useEffect(() => {
        if (!open) return;
        setParams(defaultParams);
        setInitialParams(defaultParams);
        setImage(null);
    }, [dataUrl, open]);

    useEffect(() => {
        if (!open) return;
        let active = true;
        setReadError("");
        void readImageMeta(dataUrl).then((value) => { if (active) setImage(value); }).catch((error) => { if (active) setReadError(error instanceof Error ? error.message : t("errors.imageReadFailed")); });
        return () => { active = false; };
    }, [dataUrl, open]);

    useEffect(() => {
        if (!image) return;
        const nextTarget = targetOptions.find((option) => sourceLongEdge < option.value)?.value || MAX_UPSCALE_LONG_EDGE;
        const initial = { ...defaultParams, targetLongEdge: nextTarget };
        setParams(initial);
        setInitialParams(initial);
    }, [image, sourceLongEdge]);

    return (
        <Dialog title={t("canvas.editors.upscaleTitle")} open={open && Boolean(dataUrl)} onClose={onClose} dirty={JSON.stringify(params) !== JSON.stringify(initialParams)} onConfirm={() => onConfirm(params)} confirmDisabled={!canUpscale} confirmText={t("canvas.editors.upscale")} width={820}>
            {readError ? <p role="alert" className="mb-4 text-sm text-destructive">{readError}</p> : null}
            <div className="space-y-5">
                
                <div className="grid gap-6 md:grid-cols-[minmax(260px,1fr)_360px]">
                    <div className="rounded-xl border p-4">
                        <div className="grid min-h-[280px] place-items-center rounded-lg bg-black/5">
                            <img src={dataUrl} alt="" className="max-h-[320px] max-w-full rounded-lg object-contain shadow-xl" draggable={false} />
                        </div>
                        <div className="mt-3 flex items-center justify-between text-sm">
                            <span className="opacity-60">{t("canvas.editors.source")}</span>
                            <span className="font-semibold">{image ? `${image.width} x ${image.height} px` : t("canvas.editors.loading")}</span>
                        </div>
                    </div>
                    <div className="space-y-6 py-2">
                        <div className="space-y-2">
                            <div className="font-medium opacity-75">{t("canvas.editors.targetPixels")}</div>
                            <Segmented
                                block
                                value={params.targetLongEdge}
                                options={targetOptions.map((option) => ({ label: `${option.label} · ${option.value}px`, value: option.value, disabled: Boolean(image && sourceLongEdge >= option.value) }))}
                                onChange={(value) => setParams((current) => ({ ...current, targetLongEdge: Number(value) }))}
                            />
                            {image && !canUpscale ? <div className="text-xs font-medium text-destructive">{reachedMax ? t("canvas.editors.maxReached") : t("canvas.editors.targetReached")}</div> : null}
                        </div>
                        <div className="space-y-2">
                            <div className="font-medium opacity-75">{t("canvas.editors.algorithm")}</div>
                            <Segmented
                                block
                                value={params.algorithm}
                                options={algorithms.map((algorithm) => ({
                                    value: algorithm,
                                    label: (
                                        <span className="flex min-h-12 flex-col justify-center text-left leading-5">
                                            <span className="font-medium">{t(`canvas.editors.${algorithm}`)}</span>
                                            <span className="text-xs opacity-55">{t(`canvas.editors.${algorithm}Description`)}</span>
                                        </span>
                                    ),
                                }))}
                                onChange={(value) => setParams((current) => ({ ...current, algorithm: value as ImageUpscaleAlgorithm }))}
                            />
                        </div>
                        <div className="rounded-xl border px-4 py-3 text-sm">
                            <div className="flex items-center justify-between">
                                <span className="opacity-60">{t("canvas.editors.outputSize")}</span>
                                <span className="font-semibold">{outputSize ? `${outputSize.width} x ${outputSize.height} px` : t("canvas.editors.unknown")}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </Dialog>
    );
}
