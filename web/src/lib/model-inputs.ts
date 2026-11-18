import i18n from "@/i18n";
import type { ParameterControl, ParameterOverrides } from "@/services/api/channels";

export const inputLabel = (control: { label: string; labelEn?: string }) => i18n.resolvedLanguage?.startsWith("en") ? control.labelEn || control.label : control.label;
export const inputDescription = (control: ParameterControl) => i18n.resolvedLanguage?.startsWith("en") ? control.descriptionEn || control.description : control.description;
export const inputVisible = (control: ParameterControl, values: Record<string, unknown>) => !control.when || control.when.values.some((value) => JSON.stringify(value) === JSON.stringify(values[control.when!.key]));
export const inputDefaults = (controls: ParameterControl[]) => Object.fromEntries(controls.filter((control) => control.type !== "reference" && control.default != null).map((control) => [control.key, control.default]));
export const applyInputOverrides = (controls: ParameterControl[], overrides: ParameterOverrides = {}) => controls.map((control) => {
    const merged = { ...control, ...overrides[control.key] };
    merged.suggestions = merged.options?.length ? undefined : control.suggestions?.filter((option) => typeof option.value !== "number" || (merged.min === undefined || option.value >= merged.min) && (merged.max === undefined || option.value <= merged.max));
    return merged;
}).sort((a, b) => (a.order || 0) - (b.order || 0));
