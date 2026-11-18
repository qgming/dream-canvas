import i18n from "@/i18n";
import type { ParameterControl, ParameterOverrides } from "@/services/api/channels";
import { formatBytes } from "@/lib/image-utils";

export const inputLabel = (control: { label: string; labelEn?: string }) => i18n.resolvedLanguage?.startsWith("en") ? control.labelEn || control.label : control.label;
export const inputDescription = (control: ParameterControl) => i18n.resolvedLanguage?.startsWith("en") ? control.descriptionEn || control.description : control.description;
export const inputVisible = (control: ParameterControl, values: Record<string, unknown>) => !control.when || control.when.values.some((value) => JSON.stringify(value) === JSON.stringify(values[control.when!.key]));
export const inputIsMode = (control: ParameterControl) => control.key === "mode" || ["keyframe", "workbench_mode"].includes(control.key) && control.type === "select";
export const inputDefaults = (controls: ParameterControl[]) => Object.fromEntries(controls.filter((control) => control.type !== "reference" && control.default != null).map((control) => [control.key, control.default]));
export function inputRequirements(control: ParameterControl) {
    const requirements = control.type === "asset" || control.type === "reference"
        ? [control.mimeTypes?.join(", "), control.minCount || control.required ? i18n.t("workspace.referenceMin", { count: control.minCount || 1 }) : "", control.maxCount !== undefined ? i18n.t("workspace.referenceMax", { count: control.maxCount }) : "", control.maxBytes ? `≤ ${formatBytes(control.maxBytes)}` : "", control.minWidth || control.minHeight ? `≥ ${control.minWidth || "—"} × ${control.minHeight || "—"} px` : "", control.maxWidth || control.maxHeight ? `≤ ${control.maxWidth || "—"} × ${control.maxHeight || "—"} px` : "", control.minDurationMs ? `≥ ${control.minDurationMs / 1000} s` : "", control.maxDurationMs ? `≤ ${control.maxDurationMs / 1000} s` : ""]
        : control.type === "number" ? [control.min !== undefined ? `≥ ${control.min}` : "", control.max !== undefined ? `≤ ${control.max}` : "", control.step !== undefined ? `${i18n.t("modelScripts.step")} ${control.step}` : ""] : [];
    return requirements.filter(Boolean).join(" · ");
}
export const inputHelp = (control: ParameterControl) => [inputDescription(control), inputRequirements(control)].filter(Boolean).join("\n");
export const applyInputOverrides = (controls: ParameterControl[], overrides: ParameterOverrides = {}) => controls.map((control) => {
    const merged = { ...control, ...overrides[control.key] };
    merged.suggestions = merged.options?.length ? undefined : control.suggestions?.filter((option) => typeof option.value !== "number" || (merged.min === undefined || option.value >= merged.min) && (merged.max === undefined || option.value <= merged.max));
    return merged;
}).sort((a, b) => (a.order || 0) - (b.order || 0));
