import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Segmented } from "@/components/ui/controls";
import { Slider } from "@/components/ui/controls";
import { RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PointsEstimate } from "@/components/points-estimate";
import { buildAnglePrompt, buildGenerationConfig } from "@/lib/canvas/canvas-generation-helpers";
import { useEffectiveConfig } from "@/stores/use-config-store";
import type { CanvasNodeData } from "@/types/canvas";

export type CanvasImageAngleParams = {
    horizontalAngle: number;
    pitchAngle: number;
    cameraDistance: number;
    wideAngle: boolean;
};

const defaultParams: CanvasImageAngleParams = {
    horizontalAngle: 0,
    pitchAngle: 9,
    cameraDistance: 4.8,
    wideAngle: false,
};

export function CanvasNodeAngleDialog({ node, open, onClose, onConfirm }: { node: CanvasNodeData; open: boolean; onClose: () => void; onConfirm: (params: CanvasImageAngleParams) => void | Promise<unknown> }) {
    const { t } = useTranslation();
    const [params, setParams] = useState(defaultParams);
    const config = buildGenerationConfig(useEffectiveConfig(), node, "image");
    const dataUrl = node.metadata?.content || "";

    useEffect(() => {
        if (open) setParams(defaultParams);
    }, [dataUrl, open]);

    const update = <Key extends keyof CanvasImageAngleParams>(key: Key, value: CanvasImageAngleParams[Key]) => setParams((current) => ({ ...current, [key]: value }));

    return (
        <Dialog title={t("canvas.editors.angleTitle")} description={<span className="flex flex-wrap items-center gap-2"><span>{t("canvas.editors.angleDescription")}</span><PointsEstimate model={config.model} parameters={config.modelParameters} prompt={buildAnglePrompt(params)} /></span>} open={open && Boolean(dataUrl)} onClose={onClose} dirty={JSON.stringify(params) !== JSON.stringify(defaultParams)} onConfirm={() => onConfirm(params)} confirmText={t("canvas.editors.aiGenerate")} width={860}>
            <div className="space-y-5">
                <div className="grid gap-6 md:grid-cols-[minmax(260px,1fr)_360px]">
                    <div className="flex min-h-[300px] flex-col justify-between rounded-xl border p-4">
                        <div className="grid flex-1 place-items-center">
                            <div className="relative">
                                <img src={dataUrl} alt="" className="max-h-64 max-w-64 rounded-lg object-contain" draggable={false} style={{ transform: previewTransform(params) }} />
                            </div>
                        </div>
                        <Button className="w-fit" icon={<RotateCcw className="size-4" />} onClick={() => setParams(defaultParams)}>
                            {t("canvas.editors.reset")}
                        </Button>
                    </div>
                    <div className="space-y-6 py-2">
                        <AngleSlider label={t("canvas.editors.horizontal")} value={params.horizontalAngle} min={-60} max={60} step={1} suffix="deg" onChange={(value) => update("horizontalAngle", value)} />
                        <AngleSlider label={t("canvas.editors.pitch")} value={params.pitchAngle} min={-45} max={45} step={1} suffix="deg" onChange={(value) => update("pitchAngle", value)} />
                        <AngleSlider label={t("canvas.editors.distance")} value={params.cameraDistance} min={1} max={10} step={0.1} onChange={(value) => update("cameraDistance", value)} />
                        <div className="grid grid-cols-[88px_1fr_72px] items-center gap-4">
                            <span className="font-medium opacity-75">{t("canvas.editors.lens")}</span>
                            <Segmented
                                className="w-fit"
                                value={params.wideAngle ? "wide" : "standard"}
                                options={[
                                    { label: t("canvas.editors.standard"), value: "standard" },
                                    { label: t("canvas.editors.wide"), value: "wide" },
                                ]}
                                onChange={(value) => update("wideAngle", value === "wide")}
                            />
                        </div>
                    </div>
                </div>
            </div>
        </Dialog>
    );
}

function AngleSlider({ label, value, min, max, step, suffix = "", onChange }: { label: string; value: number; min: number; max: number; step: number; suffix?: string; onChange: (value: number) => void }) {
    return (
        <div className="grid grid-cols-[88px_1fr_72px] items-center gap-4">
            <span className="font-medium opacity-75">{label}</span>
            <Slider aria-label={label} min={min} max={max} step={step} value={value} onChange={onChange} />
            <span className="whitespace-nowrap text-right font-semibold">
                {Number.isInteger(value) ? value : value.toFixed(1)}
                {suffix}
            </span>
        </div>
    );
}

function previewTransform(params: CanvasImageAngleParams) {
    const scale = 1.08 - params.cameraDistance * 0.035 + (params.wideAngle ? -0.08 : 0);
    return `perspective(520px) rotateY(${params.horizontalAngle * -0.45}deg) rotateX(${params.pitchAngle * 0.35}deg) scale(${Math.max(0.72, Math.min(1.08, scale))})`;
}
