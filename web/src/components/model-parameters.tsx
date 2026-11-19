import { useTranslation } from "react-i18next";
import { useRef, useState } from "react";
import appI18n from "@/i18n";
import { Collapsible } from "@animate-ui/react/primitives/radix-ui";
import { ChevronDown, CircleHelp } from "lucide-react";
import { Input, Textarea } from "@/components/ui/input";
import { NumberInput as InputNumber } from "@/components/ui/input";
import { Choice } from "@/components/ui/choice";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/controls";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/popover";

import { findChannelModel, resolveModelParameters, type AiConfig } from "@/stores/use-config-store";
import { useAssetStore } from "@/stores/use-asset-store";
import { assetId } from "@/services/api/assets";
import type { ParameterControl } from "@/services/api/channels";
import type { ReferenceImage } from "@/types/image";
import { inputDescription, inputHelp, inputIsMode, inputLabel, inputRequirements, inputVisible } from "@/lib/model-inputs";
import { cn } from "@/lib/utils";

export function ModelParameters({ config, model, value, onChange, disabled = false, defaultsOnly = false, compact = false, inline = false, section, references, filterControls }: { config: AiConfig; model: string; value?: Record<string, unknown>; onChange: (value: Record<string, unknown>) => void; disabled?: boolean; defaultsOnly?: boolean; compact?: boolean; inline?: boolean; section?: "mode" | "parameters"; references?: ReferenceImage[]; filterControls?: (control: ParameterControl) => boolean }) {
    useTranslation();
    const selected = findChannelModel(config, model)?.model;
    const resolved = resolveModelParameters(config, model, value);
    const parameters = selected?.parameters || [];
    const controls = parameters.filter((control) => (!filterControls || filterControls(control)) && (!section || (section === "mode" ? inputIsMode(control) : !inputIsMode(control)))).map((control) => {
        if (compact && selected?.capability === "image" && control.key === "count" && control.type === "number") return { ...control, label: appI18n.t("imageWorkbench.count"), labelEn: appI18n.t("imageWorkbench.count") };
        if (selected?.capability !== "video" || !inputIsMode(control)) return control;
        return { ...control, options: control.options?.map((option) => {
            if (!(control.key === "keyframe" && option.value === "none" || control.key === "mode" && option.value === "reference")) return option;
            const references = parameters.filter((field) => field.type === "reference" && !field.hidden && inputVisible(field, { ...resolved, [control.key]: option.value }));
            return ["image", "video", "audio"].every((role) => references.some((field) => field.role === role)) ? { ...option, label: appI18n.t("canvas.promptPanel.omniReference"), labelEn: appI18n.t("canvas.promptPanel.omniReference") } : option;
        }) };
    });
    return <ModelInputFields controls={controls} value={value} resolvedValue={defaultsOnly ? undefined : resolved} disabled={disabled} defaultsOnly={defaultsOnly} compact={compact} inline={inline} references={references} presetOnlyKeys={selected?.capability === "image" ? ["size"] : undefined} onChange={onChange} />;
}

export function ModelInputFields({ controls, value = {}, resolvedValue, onChange, disabled = false, defaultsOnly = false, assetPrefix = true, compact = false, inline = false, references = [], presetOnlyKeys = [] }: { controls: ParameterControl[]; value?: Record<string, unknown>; resolvedValue?: Record<string, unknown>; onChange: (value: Record<string, unknown>) => void; disabled?: boolean; defaultsOnly?: boolean; assetPrefix?: boolean; compact?: boolean; inline?: boolean; references?: ReferenceImage[]; presetOnlyKeys?: readonly string[] }) {
    useTranslation();
    const assets = useAssetStore((state) => state.assets);
    const resolved = { ...Object.fromEntries(controls.filter((control) => control.default != null).map((control) => [control.key, control.default])), ...(resolvedValue ?? value) };
    const visibleControls = controls.filter((control) => !control.hidden && inputVisible(control, resolved) && !(compact && control.type === "reference") && !(defaultsOnly && (control.type === "asset" || control.type === "reference")));
    if (!visibleControls.length) return null;
    const render = (control: ParameterControl) => {
            const label = inputLabel(control), description = compact ? undefined : inputDescription(control);
            const help = compact ? inputHelp(control) : "";
            const current = resolved[control.key];
            const change = (next: unknown) => onChange({ ...value, [control.key]: next });
            const range = compact && control.type === "number" && ["count", "seconds", "duration"].includes(control.key) && !control.options?.length && control.min !== undefined && control.max !== undefined && control.step !== undefined
                ? Array.from({ length: Math.floor((control.max - control.min) / control.step) + 1 }, (_, index) => {
                    const value = control.min! + index * control.step!;
                    return { value, label: String(value) };
                })
                : undefined;
            const options = control.options?.length ? control.options : range || control.suggestions;
            const assetOptions = control.type === "asset" ? [...new Map([
                ...assets.filter((asset) => asset.kind === control.role && asset.saveState === "saved").map((asset) => ({ label: asset.title, value: `${assetPrefix ? "asset:" : ""}${asset.id}` })),
                ...references.flatMap((reference) => { const id = assetId(reference.storageKey) || assetId(reference.dataUrl); return id && reference.type.startsWith(`${control.role}/`) ? [{ label: reference.name, value: `${assetPrefix ? "asset:" : ""}${id}` }] : []; }),
            ].map((option) => [option.value, option] as const)).values()] : [];
            const restricted = Boolean(control.options?.length);
            const custom = !restricted && !range && !presetOnlyKeys.includes(control.key);
            const invalidOption = Boolean((restricted || range) && current != null && !options?.some((option) => JSON.stringify(option.value) === JSON.stringify(current)));
            const inlineSelect = inline && compact && control.type !== "switch" && (control.type === "select" || control.type === "asset" || Boolean(options?.length));
            if (control.type === "reference") {
                const requirements = inputRequirements(control);
                return <div key={control.key} className="space-y-1 text-xs"><p>{label}{control.required ? " *" : ""}</p><p className="text-muted-foreground">{description || appI18n.t("workspace.referenceInputs")}</p>{requirements ? <p className="text-muted-foreground">{requirements}</p> : null}</div>;
            }
            return <div key={control.key} className={cn("flex min-w-0 gap-1.5 text-xs", inline ? "max-w-full shrink-0 flex-wrap items-center" : "flex-col", compact && !inline && (inputIsMode(control) || control.type === "textarea") && "col-span-2")}>
                {!inlineSelect ? <span className="flex min-w-0 items-center gap-1"><span>{label}{control.required && !compact ? " *" : ""}</span>{help ? <Tooltip title={help} clickable placement="top"><Button size="icon" variant="ghost" className="size-5 shrink-0 text-muted-foreground [&_svg]:size-3.5" aria-label={appI18n.t("ui.parameterHelp", { name: label })}><CircleHelp /></Button></Tooltip> : null}</span> : null}{description ? <span className="text-muted-foreground">{description}</span> : null}
                {control.type === "switch" ? <div className="flex items-center gap-2"><Switch size="small" aria-label={label} disabled={disabled} checked={current === true} onChange={change} />{current == null && control.required ? <button type="button" className="text-muted-foreground hover:text-foreground" disabled={disabled} onClick={() => change(false)}>{appI18n.t("workspace.selectOff")}</button> : null}{current != null && !control.required ? <button type="button" className="text-muted-foreground hover:text-foreground" disabled={disabled} onClick={() => change(null)}>{appI18n.t("ui.clear")}</button> : null}</div>
                    : compact && (control.type === "select" || restricted || options?.length) ? <ParameterSelect control={control} label={label} options={options || []} value={current} onChange={change} disabled={disabled} invalid={invalidOption} custom={custom} clearable={!control.required || defaultsOnly} inline={inline} />
                    : control.type === "select" || restricted || control.type !== "number" && options?.length ? <Choice aria-label={label} aria-invalid={invalidOption || undefined} disabled={disabled} clearable={!control.required || defaultsOnly} value={current == null ? undefined : restricted ? JSON.stringify(current) : String(current)} searchable creatable={custom} options={options?.map((option) => ({ label: inputLabel(option), value: restricted ? JSON.stringify(option.value) : String(option.value) }))} onChange={(next) => change(next === undefined ? null : restricted ? JSON.parse(next) : next)} />
                    : control.type === "number" ? <div className="space-y-1.5"><InputNumber className={inline ? "w-24" : "!w-full"} aria-label={label} disabled={disabled} min={control.min} max={control.max} step={control.step} value={typeof current === "number" ? current : null} onChange={change} />{options?.length ? <div className="flex flex-wrap gap-1">{options.map((option) => <button key={String(option.value)} type="button" disabled={disabled} aria-pressed={current === option.value} className="rounded px-2 py-1 text-xs hover:bg-accent aria-pressed:bg-accent" onClick={() => change(option.value)}>{inputLabel(option)}</button>)}</div> : null}</div>
                    : control.type === "asset" ? compact ? <ParameterSelect control={control} label={label} options={assetOptions} value={current} onChange={change} disabled={disabled} invalid={false} custom={false} clearable inline={inline} /> : <Choice aria-label={label} disabled={disabled} clearable value={typeof current === "string" ? current : undefined} placeholder={appI18n.t("workspace.chooseSavedAsset")} options={assetOptions} onChange={(next) => change(next ?? null)} />
                    : control.type === "textarea" ? <div className={inline ? "w-48 max-w-full" : undefined}><Textarea aria-label={label} minLength={control.minLength} maxLength={control.maxLength} disabled={disabled} value={typeof current === "string" ? current : ""} autoSize onChange={(event) => change(event.target.value)} /></div>
                    : <Input className={inline ? "w-28" : undefined} aria-label={label} minLength={control.minLength} maxLength={control.maxLength} disabled={disabled} value={typeof current === "string" ? current : ""} onChange={(event) => change(event.target.value)} />}
                {invalidOption ? <span role="alert" className="text-destructive">{appI18n.t("modelScripts.valueOutsideOptions")}</span> : null}
            </div>;
    };
    return <div className={inline ? "contents" : cn("grid gap-3", compact && "grid-cols-2")} onPointerDown={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
        {visibleControls.filter((control) => inline || !control.advanced || compact && inputIsMode(control)).map(render)}
        {!inline && visibleControls.some((control) => control.advanced && !(compact && inputIsMode(control))) ? <Collapsible.Root className={compact ? "col-span-2" : undefined}><Collapsible.Trigger className="group flex w-full items-center justify-between text-left text-xs text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">{appI18n.t("modelScripts.advanced")}<ChevronDown className="size-3.5 transition-transform group-data-[state=open]:rotate-180" /></Collapsible.Trigger><Collapsible.Content><div className={cn("mt-3 grid gap-3", compact && "grid-cols-2")}>{visibleControls.filter((control) => control.advanced && !(compact && inputIsMode(control))).map(render)}</div></Collapsible.Content></Collapsible.Root> : null}
    </div>;
}

function ParameterSelect({ control, label, options, value, onChange, disabled, invalid, custom, clearable, inline = false }: { control: ParameterControl; label: string; options: NonNullable<ParameterControl["options"]>; value: unknown; onChange: (value: unknown) => void; disabled: boolean; invalid: boolean; custom: boolean; clearable: boolean; inline?: boolean }) {
    const { t } = useTranslation();
    const [editingCustom, setEditingCustom] = useState(false);
    const customInputRef = useRef<HTMLInputElement>(null);
    const selected = value == null ? undefined : options.find((option) => JSON.stringify(option.value) === JSON.stringify(value));
    const customInput = custom && (editingCustom || value != null && !selected);
    const current = customInput ? "custom" : value == null ? "empty" : JSON.stringify(value);
    const trigger = <SelectTrigger className={inline ? "w-auto max-w-full gap-1 px-2 text-xs" : undefined} aria-label={label} aria-invalid={invalid || undefined} aria-required={control.required}>
        <SelectValue>{customInput ? t("ui.customValue") : value == null ? t(control.required ? "ui.select" : "ui.defaultOption") : inline && ["ratio", "size"].includes(control.key) ? String(value) : selected ? inputLabel(selected) : String(value)}</SelectValue>
    </SelectTrigger>;
    return <div className={cn("min-w-0", inline ? "flex max-w-48 items-center gap-1.5" : "space-y-1.5")}>
        <Select value={current} disabled={disabled} onValueChange={(next) => {
            setEditingCustom(next === "custom");
            if (next !== "custom") onChange(next === "empty" ? null : JSON.parse(next));
        }}>
            {inline ? <Tooltip title={[label, selected && inputLabel(selected), inputHelp(control)].filter(Boolean).join("\n")} placement="top">{trigger}</Tooltip> : trigger}
            <SelectContent onCloseAutoFocus={(event) => { if (editingCustom) { event.preventDefault(); customInputRef.current?.focus(); } }}>
                {clearable || value == null ? <SelectItem value="empty" disabled={!clearable}>{t(control.required ? "ui.select" : "ui.defaultOption")}</SelectItem> : null}
                {options.map((option) => <SelectItem key={JSON.stringify(option.value)} value={JSON.stringify(option.value)}>{inputLabel(option)}</SelectItem>)}
                {custom ? <SelectItem value="custom">{t("ui.customValue")}</SelectItem> : null}
            </SelectContent>
        </Select>
        {customInput ? control.type === "number" ? <InputNumber ref={customInputRef} className={inline ? "w-24" : undefined} aria-label={t("ui.customParameter", { name: label })} disabled={disabled} min={control.min} max={control.max} step={control.step} value={typeof value === "number" ? value : null} onChange={onChange} /> : <Input ref={customInputRef} className={inline ? "w-24" : undefined} aria-label={t("ui.customParameter", { name: label })} disabled={disabled} minLength={control.minLength} maxLength={control.maxLength} value={typeof value === "string" ? value : ""} onChange={(event) => onChange(event.target.value)} /> : null}
    </div>;
}

