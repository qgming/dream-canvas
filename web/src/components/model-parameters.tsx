import { useTranslation } from "react-i18next";
import appI18n from "@/i18n";
import { Input, Textarea } from "@/components/ui/input";
import { NumberInput as InputNumber } from "@/components/ui/input";
import { Choice } from "@/components/ui/choice";
import { Switch } from "@/components/ui/controls";

import { decodeChannelModel, resolveModelParameters, type AiConfig } from "@/stores/use-config-store";
import { useAssetStore } from "@/stores/use-asset-store";
import { formatBytes } from "@/lib/image-utils";
import type { ParameterControl } from "@/services/api/channels";
import { inputDescription, inputLabel, inputVisible } from "@/lib/model-inputs";

export function ModelParameters({ config, model, value, onChange, disabled = false, defaultsOnly = false }: { config: AiConfig; model: string; value?: Record<string, unknown>; onChange: (value: Record<string, unknown>) => void; disabled?: boolean; defaultsOnly?: boolean }) {
    useTranslation();
    const selected = decodeChannelModel(model);
    const controls = config.channels.find((channel) => channel.id === selected?.channelId)?.models.find((entry) => entry.name === selected?.model)?.parameters || [];
    const resolved = resolveModelParameters(config, model, value);
    return <ModelInputFields controls={controls} value={value} resolvedValue={defaultsOnly ? undefined : resolved} disabled={disabled} defaultsOnly={defaultsOnly} onChange={onChange} />;
}

export function ModelInputFields({ controls, value = {}, resolvedValue, onChange, disabled = false, defaultsOnly = false, assetPrefix = true }: { controls: ParameterControl[]; value?: Record<string, unknown>; resolvedValue?: Record<string, unknown>; onChange: (value: Record<string, unknown>) => void; disabled?: boolean; defaultsOnly?: boolean; assetPrefix?: boolean }) {
    useTranslation();
    const assets = useAssetStore((state) => state.assets);
    const resolved = { ...Object.fromEntries(controls.filter((control) => control.default != null).map((control) => [control.key, control.default])), ...(resolvedValue ?? value) };
    if (!controls.length) return null;
    const render = (control: ParameterControl) => {
            if (control.hidden || !inputVisible(control, resolved)) return null;
            const label = inputLabel(control), description = inputDescription(control);
            if (defaultsOnly && (control.type === "asset" || control.type === "reference")) return null;
            const current = resolved[control.key];
            const change = (next: unknown) => onChange({ ...value, [control.key]: next });
            const options = control.options?.length ? control.options : control.suggestions;
            const restricted = Boolean(control.options?.length);
            const invalidOption = restricted && current != null && !control.options!.some((option) => JSON.stringify(option.value) === JSON.stringify(current));
            if (control.type === "reference") {
                const requirements = [control.mimeTypes?.join(", "), control.minCount || control.required ? appI18n.t("workspace.referenceMin", { count: control.minCount || 1 }) : "", control.maxCount !== undefined ? appI18n.t("workspace.referenceMax", { count: control.maxCount }) : "", control.maxBytes ? `≤ ${formatBytes(control.maxBytes)}` : "", control.minWidth || control.minHeight ? `≥ ${control.minWidth || "—"} × ${control.minHeight || "—"} px` : "", control.maxWidth || control.maxHeight ? `≤ ${control.maxWidth || "—"} × ${control.maxHeight || "—"} px` : "", control.minDurationMs ? `≥ ${control.minDurationMs / 1000} s` : "", control.maxDurationMs ? `≤ ${control.maxDurationMs / 1000} s` : ""].filter(Boolean);
                return <div key={control.key} className="space-y-1 text-xs"><p>{label}{control.required ? " *" : ""}</p><p className="text-muted-foreground">{description || appI18n.t("workspace.referenceInputs")}</p>{requirements.length ? <p className="text-muted-foreground">{requirements.join(" · ")}</p> : null}</div>;
            }
            return <label key={control.key} className="flex min-w-0 flex-col gap-1.5 text-xs">
                <span>{label}{control.required ? " *" : ""}</span>{description ? <span className="text-muted-foreground">{description}</span> : null}
                {control.type === "switch" ? <div className="flex items-center gap-2"><Switch size="small" aria-label={label} disabled={disabled} checked={current === true} onChange={change} />{current == null && control.required ? <button type="button" className="text-muted-foreground hover:text-foreground" disabled={disabled} onClick={() => change(false)}>{appI18n.t("workspace.selectOff")}</button> : null}{current != null && !control.required ? <button type="button" className="text-muted-foreground hover:text-foreground" disabled={disabled} onClick={() => change(null)}>{appI18n.t("ui.clear")}</button> : null}</div>
                    : control.type === "select" || restricted || control.type !== "number" && options?.length ? <Choice aria-label={label} aria-invalid={invalidOption || undefined} disabled={disabled} clearable={!control.required || defaultsOnly} value={current == null ? undefined : restricted ? JSON.stringify(current) : String(current)} searchable creatable={!restricted} options={options?.map((option) => ({ label: inputLabel(option), value: restricted ? JSON.stringify(option.value) : String(option.value) }))} onChange={(next) => change(next === undefined ? null : restricted ? JSON.parse(next) : next)} />
                    : control.type === "number" ? <div className="space-y-1.5"><InputNumber className="!w-full" aria-label={label} disabled={disabled} min={control.min} max={control.max} step={control.step} value={typeof current === "number" ? current : null} onChange={change} />{options?.length ? <div className="flex flex-wrap gap-1">{options.map((option) => <button key={String(option.value)} type="button" disabled={disabled} aria-pressed={current === option.value} className="rounded px-2 py-1 text-xs hover:bg-accent aria-pressed:bg-accent" onClick={() => change(option.value)}>{inputLabel(option)}</button>)}</div> : null}</div>
                    : control.type === "asset" ? <Choice aria-label={label} disabled={disabled} clearable value={typeof current === "string" ? current : undefined} placeholder={appI18n.t("workspace.chooseSavedAsset")} options={assets.filter((asset) => asset.kind === control.role && asset.saveState === "saved").map((asset) => ({ label: asset.title, value: `${assetPrefix ? "asset:" : ""}${asset.id}` }))} onChange={(next) => change(next ?? null)} />
                    : control.type === "textarea" ? <Textarea aria-label={label} minLength={control.minLength} maxLength={control.maxLength} disabled={disabled} value={typeof current === "string" ? current : ""} autoSize onChange={(event) => change(event.target.value)} />
                    : <Input aria-label={label} minLength={control.minLength} maxLength={control.maxLength} disabled={disabled} value={typeof current === "string" ? current : ""} onChange={(event) => change(event.target.value)} />}
                {invalidOption ? <span role="alert" className="text-destructive">{appI18n.t("modelScripts.valueOutsideOptions")}</span> : null}
            </label>;
    };
    return <div className="grid gap-3" onPointerDown={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
        {controls.filter((control) => !control.advanced).map(render)}
        {controls.some((control) => control.advanced && !control.hidden && inputVisible(control, resolved)) ? <details className="space-y-3"><summary className="cursor-pointer text-xs text-muted-foreground">{appI18n.t("modelScripts.advanced")}</summary><div className="mt-3 grid gap-3">{controls.filter((control) => control.advanced).map(render)}</div></details> : null}
    </div>;
}

