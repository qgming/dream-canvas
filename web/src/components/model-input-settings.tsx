import { useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/form";
import { Disclosure } from "@/components/ui/tabs";
import { Choice } from "@/components/ui/choice";
import { Input, NumberInput, Textarea } from "@/components/ui/input";
import { Switch } from "@/components/ui/controls";
import { Badge } from "@/components/ui/display";
import { ModelInputFields } from "@/components/model-parameters";
import type { Capability, ModelPricing, ParameterControl, ParameterOverrides, PricingRates } from "@/services/api/channels";
import { applyInputOverrides, inputLabel } from "@/lib/model-inputs";

type PricingRate = PricingRates[string];
type PricingTier = NonNullable<ModelPricing["tiers"]>[number];

const pricingUnits = ["uncached_input_tokens", "cached_tokens", "output_tokens", "images", "seconds", "characters", "requests"];
const recommendedUnits: Record<Capability, string[]> = {
    text: ["uncached_input_tokens", "cached_tokens", "output_tokens", "requests"],
    image: ["images", "requests"],
    video: ["seconds", "requests"],
    audio: ["characters", "seconds", "requests"],
};

function overrideError(control: ParameterControl, options: { label?: string; value: unknown }[]) {
    if (control.options?.length && !options.length) return "optionsRequired";
    if (options.some((option) => !option.label || option.value === "" || typeof option.value === "number" && !Number.isFinite(option.value) || control.type !== "select" && typeof option.value !== (control.type === "number" ? "number" : "string")) || new Set(options.map((option) => JSON.stringify(option.value))).size !== options.length) return "optionsInvalid";
    return "";
}

function AdvancedOverrideEditor({ control, current, effective, onChange }: { control: ParameterControl; current: ParameterOverrides[string] | undefined; effective: ParameterControl; onChange: (change: ParameterOverrides[string]) => void }) {
    const { t } = useTranslation();
    const [rootError, setRootError] = useState("");
    const update = (change: Partial<ParameterOverrides[string]>) => {
        setRootError("");
        onChange({ ...current, ...change });
    };
    const changeOptions = (values: string[]) => {
        const options = control.options?.length ? control.options.filter((option) => values.includes(JSON.stringify(option.value))) : values.map((value) => control.suggestions?.find((option) => String(option.value) === value) || { label: value.trim(), value: control.type === "number" ? Number(value) : value.trim() });
        const issue = overrideError(control, options);
        if (issue) setRootError(t(`modelScripts.${issue}`));
        else if (current?.default != null && !options.some((option) => JSON.stringify(option.value) === JSON.stringify(current.default))) setRootError(t("modelScripts.defaultOutsideOptions"));
        else update({ options });
    };
    return <div className="space-y-4 border-t border-border pt-3">
        <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("modelScripts.labelZh")}><Input value={effective.label} onChange={(event) => update({ label: event.target.value })} /></Field>
            <Field label={t("modelScripts.labelEn")}><Input value={effective.labelEn || ""} onChange={(event) => update({ labelEn: event.target.value })} /></Field>
            <Field label={t("modelScripts.descriptionZh")}><Textarea autoSize value={effective.description || ""} onChange={(event) => update({ description: event.target.value })} /></Field>
            <Field label={t("modelScripts.descriptionEn")}><Textarea autoSize value={effective.descriptionEn || ""} onChange={(event) => update({ descriptionEn: event.target.value })} /></Field>
            <Field label={t("modelScripts.order")}><NumberInput precision={0} value={effective.order ?? 0} onChange={(value) => update({ order: value ?? 0 })} /></Field>
            <div className="grid grid-cols-3 gap-2">
                <Field label={t("modelScripts.hidden")}><Switch size="small" checked={effective.hidden} onChange={(hidden) => update({ hidden })} /></Field>
                <Field label={t("modelScripts.advanced")}><Switch size="small" checked={effective.advanced} onChange={(advanced) => update({ advanced })} /></Field>
                <Field label={t("modelScripts.required")}><Switch size="small" checked={effective.required} disabled={control.required} onChange={(required) => update({ required: control.required || required })} /></Field>
            </div>
        </div>
        {["select", "text", "textarea", "number"].includes(control.type) ? <Field label={t("modelScripts.allowedOptions")} description={control.type === "select" ? undefined : t("modelScripts.textOptionsHint")}><Choice multiple searchable={control.type !== "select"} creatable={!control.options?.length} value={(effective.options || []).map((option) => control.options?.length ? JSON.stringify(option.value) : String(option.value))} options={(control.options?.length ? control.options : control.suggestions)?.map((option) => ({ label: inputLabel(option), value: control.options?.length ? JSON.stringify(option.value) : String(option.value) }))} onChange={changeOptions} /></Field> : null}
        {control.type === "number" ? <div className="grid grid-cols-2 gap-3"><Field label={t("modelScripts.min")} schema={z.number().min(control.min ?? -Infinity, t("modelScripts.minOutsideScript")).nullable().optional()}><NumberInput value={effective.min ?? null} min={control.min} max={effective.max ?? undefined} step={control.step} onChange={(min) => update({ min })} /></Field><Field label={t("modelScripts.max")} schema={z.number().max(control.max ?? Infinity, t("modelScripts.maxOutsideScript")).nullable().optional()}><NumberInput value={effective.max ?? null} min={effective.min ?? undefined} max={control.max} step={control.step} onChange={(max) => update({ max })} /></Field></div> : null}
        {current?.hidden && current.required && current.default == null ? <p role="alert" className="text-xs text-destructive">{t("ui.invalidValue")}</p> : null}
        {rootError ? <p role="alert" className="text-xs text-destructive">{rootError}</p> : null}
    </div>;
}

function ParameterRow({ control, base, override, onChange }: { control: ParameterControl; base: ParameterControl; override: ParameterOverrides[string] | undefined; onChange: (value: ParameterOverrides[string] | undefined) => void }) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const updateDefault = (value: unknown) => onChange({ ...override, default: value });
    const media = control.type === "reference" || control.type === "asset";
    return <div className="px-3 py-3">
        <div className="grid items-start gap-3 md:grid-cols-[minmax(12rem,.8fr)_minmax(14rem,1.2fr)_auto]">
            <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-1.5"><span className="break-words text-sm font-medium">{inputLabel(control)}</span><span className="font-mono text-xs text-muted-foreground">{control.key}</span>{control.required ? <Badge>{t("modelScripts.required")}</Badge> : null}{control.hidden ? <Badge>{t("modelScripts.hidden")}</Badge> : null}{control.advanced ? <Badge>{t("modelScripts.advanced")}</Badge> : null}</div>
                {control.description ? <p className="text-xs leading-5 text-muted-foreground">{control.description}</p> : null}
            </div>
            <div className="min-w-0">
                {media ? <p className="text-xs leading-5 text-muted-foreground">{t("modelScripts.mediaScriptOwned")}</p> : <ModelInputFields defaultsOnly controls={[{ ...control, hidden: false, advanced: false, when: undefined }]} value={{}} onChange={(values) => updateDefault(values[control.key])} />}
            </div>
            <div className="flex justify-end gap-1">{override ? <Button size="sm" variant="ghost" onClick={() => onChange(undefined)}>{t("modelScripts.resetField")}</Button> : null}<Button size="sm" variant="ghost" aria-expanded={open} onClick={() => setOpen((value) => !value)}>{t("modelScripts.fieldSettings")}</Button></div>
        </div>
        <Disclosure title={t("modelScripts.advancedSettings")} open={open} onOpenChange={setOpen}>
            <AdvancedOverrideEditor control={base} current={override} effective={control} onChange={onChange} />
        </Disclosure>
    </div>;
}

export function ModelInputSettings({ controls, value = {}, onChange }: { controls: ParameterControl[]; value: ParameterOverrides; onChange: (value: ParameterOverrides) => void }) {
    const { t } = useTranslation();
    const effective = applyInputOverrides(controls, value);
    const update = (key: string, next: ParameterOverrides[string] | undefined) => {
        const changes = { ...value };
        if (next) changes[key] = next; else delete changes[key];
        onChange(changes);
    };
    return <div className="space-y-2">
        <p className="text-xs leading-5 text-muted-foreground">{t("modelScripts.overridesHint")}</p>
        {effective.length ? <div className="divide-y divide-border rounded-lg border border-border">{effective.map((control) => <ParameterRow key={control.key} control={control} base={controls.find((item) => item.key === control.key) || control} override={value[control.key]} onChange={(next) => update(control.key, next)} />)}</div> : <p className="text-sm text-muted-foreground">{t("modelScripts.noInputs")}</p>}
    </div>;
}

function RateTable({ rates, units, recommended = [], onChange }: { rates: Record<string, PricingRate>; units: string[]; recommended?: string[]; onChange: (rates: Record<string, PricingRate>) => void }) {
    const { t } = useTranslation();
    const ordered = [...Object.keys(rates)].sort((left, right) => units.indexOf(left) - units.indexOf(right));
    const change = (unit: string, key: keyof PricingRate, next: string) => {
        const updated = { ...rates[unit], [key]: key !== "per" && next === "" ? undefined : next };
        onChange({ ...rates, [unit]: updated });
    };
    return <div className="space-y-2">
        <div className="overflow-x-auto rounded-lg border border-border">
            <div className="min-w-[42rem]"><div className="grid grid-cols-[minmax(10rem,1fr)_5rem_minmax(7rem,.8fr)_minmax(7rem,.8fr)_2.5rem] gap-2 border-b border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground"><span>{t("modelScripts.unit")}</span><span>{t("modelScripts.per")}</span><span>{t("modelScripts.amount")}</span><span>{t("modelScripts.points")}</span><span /></div>
            {ordered.length ? ordered.map((unit) => <div key={unit} className="grid grid-cols-[minmax(10rem,1fr)_5rem_minmax(7rem,.8fr)_minmax(7rem,.8fr)_2.5rem] items-center gap-2 border-b border-border px-3 py-2 last:border-b-0">
                <span className="min-w-0 break-words text-xs">{t(`modelScripts.units.${unit}`, { defaultValue: unit })}</span>
                {(["per", "amount", "points"] as const).map((key) => <Input key={key} inputMode="decimal" aria-label={`${t(`modelScripts.${key}`)} ${unit}`} value={rates[unit][key] || ""} placeholder={key === "per" ? "1" : t("modelScripts.unknown")} onChange={(event) => change(unit, key, event.target.value)} />)}
                <Button size="icon" variant="ghost" aria-label={t("common.delete")} onClick={() => { const next = { ...rates }; delete next[unit]; onChange(next); }}>×</Button>
            </div>) : <p className="px-3 py-6 text-center text-sm text-muted-foreground">{t("modelScripts.noRates")}</p>}</div>
        </div>
        <Choice value={undefined} placeholder={t("modelScripts.addRate")} options={units.filter((unit) => !rates[unit]).map((unit) => ({ value: unit, label: <span className="flex items-center gap-2"><span>{t(`modelScripts.units.${unit}`, { defaultValue: unit })}</span>{recommended.includes(unit) ? <Badge>{t("modelScripts.recommended")}</Badge> : null}</span> }))} onChange={(unit) => onChange({ ...rates, [unit]: { per: "1" } })} />
    </div>;
}

function defaultConditionValue(control: ParameterControl): string | number | boolean {
    if (control.type === "switch") return typeof control.default === "boolean" ? control.default : true;
    if (control.options?.length) return control.options[0].value;
    if (control.suggestions?.length) return control.suggestions[0].value;
    if (control.type === "number" && typeof control.default === "number") return control.default;
    return "";
}

function ConditionValue({ control, value, onChange }: { control: ParameterControl; value: string | number | boolean; onChange: (value: string | number | boolean) => void }) {
    const { t } = useTranslation();
    if (control.type === "switch") return <Choice value={String(value)} options={[{ value: "true", label: t("modelScripts.true") }, { value: "false", label: t("modelScripts.false") }]} onChange={(next) => onChange(next === "true")} />;
    if (control.type === "select" || control.options?.length) return <Choice searchable value={JSON.stringify(value)} options={control.options?.map((option) => ({ value: JSON.stringify(option.value), label: inputLabel(option) }))} onChange={(next) => onChange(JSON.parse(next))} />;
    if (control.type === "number") return <NumberInput value={typeof value === "number" ? value : null} min={control.min} max={control.max} step={control.step} onChange={(next) => onChange(next ?? "")} />;
    return <Input value={typeof value === "string" ? value : String(value)} onChange={(event) => onChange(event.target.value)} />;
}

function TierCard({ tier, index, controls, units, onChange, onRemove }: { tier: PricingTier; index: number; controls: ParameterControl[]; units: string[]; onChange: (tier: PricingTier) => void; onRemove: () => void }) {
    const { t } = useTranslation();
    const available = controls.filter((control) => !(control.key in tier.conditions));
    const updateCondition = (key: string, value: string | number | boolean) => onChange({ ...tier, conditions: { ...tier.conditions, [key]: value } });
    return <div className="space-y-3 rounded-lg border border-border p-3">
        <div className="flex items-center justify-between gap-3"><h4 className="text-sm font-medium">{t("modelScripts.tier", { index: index + 1 })}</h4><Button size="sm" variant="ghost" onClick={onRemove}>{t("common.delete")}</Button></div>
        <div className="space-y-2">
            {Object.keys(tier.conditions).length === 0 ? <p role="alert" className="text-xs text-destructive">{t("modelScripts.conditionRequired")}</p> : null}
            {Object.entries(tier.conditions).map(([key, value], conditionIndex) => {
                const control = controls.find((item) => item.key === key);
                return <div key={key} className="grid items-end gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                    <div className="text-xs"><span className="text-muted-foreground">{conditionIndex ? <Badge>{t("modelScripts.and")}</Badge> : null}</span><p className="mt-1 break-all font-mono">{key}</p></div>
                    {control ? <><ConditionValue control={control} value={value} onChange={(next) => updateCondition(key, next)} /><Button size="icon" variant="ghost" aria-label={t("common.delete")} onClick={() => { const conditions = { ...tier.conditions }; delete conditions[key]; onChange({ ...tier, conditions }); }}>×</Button></> : <p className="text-xs text-destructive">{t("modelScripts.conditionControlMissing")}</p>}
                </div>;
            })}
            {available.length ? <Choice value={undefined} placeholder={t("modelScripts.addCondition")} options={available.map((control) => ({ value: control.key, label: `${inputLabel(control)} · ${control.key}` }))} onChange={(key) => { const control = controls.find((item) => item.key === key)!; updateCondition(key, defaultConditionValue(control)); }} /> : <p className="text-xs text-muted-foreground">{t("modelScripts.noMoreConditions")}</p>}
        </div>
        <p className="text-xs leading-5 text-muted-foreground">{t("modelScripts.tierRatesReplace")}</p>
        <RateTable rates={tier.rates} units={units} onChange={(rates) => onChange({ ...tier, rates })} />
    </div>;
}

export function ModelPricingFields({ value = {}, onChange, capability = "image", controls = [] }: { value: ModelPricing; onChange: (value: ModelPricing) => void; capability?: Capability; controls?: ParameterControl[] }) {
    const { t } = useTranslation();
    const [currencyOpen, setCurrencyOpen] = useState(Boolean(value.exchangeRate || value.currency && value.currency !== "CNY"));
    const rates = value.rates || {};
    const tiers = value.tiers || [];
    const preferred = recommendedUnits[capability] || [];
    const units = [...new Set([...preferred, ...Object.keys(rates), ...pricingUnits])];
    const tierUnits = [...new Set([...preferred, ...tiers.flatMap((tier) => Object.keys(tier.rates)), ...pricingUnits])];
    const conditionControls = controls.filter((control) => ["text", "textarea", "number", "switch", "select"].includes(control.type));
    const ambiguous = new Set<number>();
    for (let left = 0; left < tiers.length; left++) {
        for (let right = left + 1; right < tiers.length; right++) {
            const overlap = !Object.entries(tiers[left].conditions).some(([key, value]) => key in tiers[right].conditions && JSON.stringify(value) !== JSON.stringify(tiers[right].conditions[key]));
            if (overlap) {
                ambiguous.add(left);
                ambiguous.add(right);
            }
        }
    }
    const changeRates = (next: PricingRates) => onChange({ ...value, currency: value.currency || "CNY", rates: next });
    const changeTiers = (next: PricingTier[]) => onChange({ ...value, currency: value.currency || "CNY", tiers: next });
    return <div className="space-y-5">
        <div><h3 className="text-sm font-medium">{t("modelScripts.basePrice")}</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">{t("modelScripts.pricingHint")}</p></div>
        <RateTable rates={rates} units={units} recommended={preferred} onChange={changeRates} />
        <Disclosure title={<span className="flex items-center gap-2">{t("modelScripts.currencySettings")}<Badge>{value.currency || "CNY"}</Badge></span>} open={currencyOpen} onOpenChange={setCurrencyOpen}>
            <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1.5 text-xs"><span className="font-medium">{t("modelScripts.currency")}</span><Input value={value.currency || "CNY"} maxLength={3} onChange={(event) => onChange({ ...value, currency: event.target.value.toUpperCase() })} /></label>
                <label className="space-y-1.5 text-xs"><span className="font-medium">{t("modelScripts.exchangeRate")}</span><Input inputMode="decimal" placeholder={t("modelScripts.unknown")} value={value.exchangeRate || ""} onChange={(event) => onChange({ ...value, exchangeRate: event.target.value || undefined })} /></label>
            </div>
        </Disclosure>
        <div className="space-y-3 border-t border-border pt-4">
            <div><h3 className="text-sm font-medium">{t("modelScripts.priceTiers")}</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">{t("modelScripts.priceTiersHint")}</p></div>
            {ambiguous.size ? <p role="alert" className="text-xs text-destructive">{t("modelScripts.ambiguousTiers")}</p> : null}
            {tiers.map((tier, index) => <TierCard key={tier.id || index} tier={tier} index={index} controls={conditionControls} units={tierUnits} onChange={(next) => changeTiers(tiers.map((item, itemIndex) => itemIndex === index ? next : item))} onRemove={() => changeTiers(tiers.filter((_, itemIndex) => itemIndex !== index))} />)}
            <Button size="sm" variant="ghost" onClick={() => changeTiers([...tiers, { conditions: {}, rates: {} }])}>{t("modelScripts.addTier")}</Button>
        </div>
    </div>;
}
