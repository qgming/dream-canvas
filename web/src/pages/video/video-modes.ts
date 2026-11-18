import type { ParameterControl } from "@/services/api/channels";
import { inputVisible } from "@/lib/model-inputs";

// Some scripts declare keyframe usage instead of a mode parameter. Keep their actual request values.
export function keyframeModeInput(controls: ParameterControl[], values: Record<string, unknown>): ParameterControl | undefined {
    if (controls.some((control) => control.key === "mode")) return undefined;
    const control = controls.find((control) => control.key === "keyframe" && control.type === "select" && !control.hidden && inputVisible(control, values));
    if (!control?.options?.some((option) => option.value === "none") || !control.options.every((option) => ["none", "first", "last", "both"].includes(String(option.value)))) return undefined;
    const references = controls.filter((field) => field.type === "reference" && inputVisible(field, { ...values, [control.key]: "none" }));
    if (!references.some((field) => field.role === "image")) return undefined;
    const multimodal = ["image", "video", "audio"].every((role) => references.some((field) => field.role === role));
    const modes = control.options.flatMap<NonNullable<ParameterControl["options"]>[number]>((option) => option.value === "none" ? [
        ...(!references.some((field) => field.required || (field.minCount || 0) > 0) ? [{ label: "文生视频", labelEn: "Text to video", value: "text" }] : []),
        { label: multimodal ? "全能参考" : "参考素材", labelEn: multimodal ? "Multimodal references" : "Reference media", value: "reference" },
    ] : [{ ...option, label: option.value === "first" ? "图生视频（仅首帧）" : option.label, labelEn: option.value === "first" ? "Image to video (first frame)" : option.labelEn }]);
    return { ...control, key: "workbench_mode", label: "生成模式", labelEn: "Generation mode", required: true, default: undefined, options: modes };
}
