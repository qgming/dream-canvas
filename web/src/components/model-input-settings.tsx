import { useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EditorForm, Field, useEditorForm } from "@/components/ui/form";
import { Choice } from "@/components/ui/choice";
import { Input, NumberInput, Textarea } from "@/components/ui/input";
import { Switch } from "@/components/ui/controls";
import { ModelInputFields } from "@/components/model-parameters";
import type { ModelPricing, ParameterControl, ParameterOverrides } from "@/services/api/channels";
import { applyInputOverrides, inputLabel } from "@/lib/model-inputs";

export function ModelInputSettings({ controls, value = {}, onChange }: { controls: ParameterControl[]; value: ParameterOverrides; onChange: (value: ParameterOverrides) => void }) {
    const { t } = useTranslation();
    const form = useEditorForm();
    const [editing, setEditing] = useState<ParameterControl | null>(null);
    const effective = applyInputOverrides(controls, value);
    const update = (key: string, change: ParameterOverrides[string]) => onChange({ ...value, [key]: { ...value[key], ...change } });
    return <div className="space-y-4">
        <p className="text-xs leading-5 text-muted-foreground">{t("modelScripts.overridesHint")}</p>
        {effective.length ? <div className="grid gap-4 sm:grid-cols-2">{effective.map((control) => <div key={control.key} className="min-w-0 space-y-2 rounded-lg border border-border p-3">
            <div className="flex items-center justify-between gap-2"><span className="text-sm font-medium">{inputLabel(control)} <span className="font-mono text-xs font-normal text-muted-foreground">{control.key}</span></span><Button size="sm" variant="ghost" onClick={() => { form.reset({ ...control, options: control.options?.map((option) => JSON.stringify(option.value)) || [] }); setEditing(control); }}>{t("common.edit")}</Button></div>
            {control.type === "reference" || control.type === "asset" ? <p className="text-xs text-muted-foreground">{t("modelScripts.mediaScriptOwned")}</p> : <ModelInputFields defaultsOnly controls={[{ ...control, hidden: false, advanced: false, when: undefined }]} value={{}} onChange={(values) => update(control.key, { default: values[control.key] })} />}
            {control.hidden ? <p className="text-xs text-muted-foreground">{t("modelScripts.hidden")}</p> : null}
            {value[control.key] ? <Button size="sm" variant="ghost" onClick={() => { const next = { ...value }; delete next[control.key]; onChange(next); }}>{t("modelScripts.resetField")}</Button> : null}
        </div>)}</div> : <p className="text-sm text-muted-foreground">{t("modelScripts.noInputs")}</p>}
        <Dialog title={t("modelScripts.inputSettings")} open={Boolean(editing)} onClose={() => setEditing(null)} footer={<Button type="submit" form="model-input-override">{t("common.save")}</Button>}>
            {editing ? <EditorForm id="model-input-override" form={form} onSubmit={(values) => {
                const base = controls.find((control) => control.key === editing.key)!;
                const change: ParameterOverrides[string] = { label: values.label, labelEn: values.labelEn, description: values.description, descriptionEn: values.descriptionEn, hidden: values.hidden, advanced: values.advanced, order: values.order ?? 0, required: base.required || values.required };
                if (editing.type === "select") change.options = base.options?.filter((option) => values.options.includes(JSON.stringify(option.value)));
                if (editing.type === "number") { change.min = values.min ?? base.min; change.max = values.max ?? base.max; }
                const next = { ...value[editing.key], ...change };
                const previousDefault = next.default === undefined ? base.default : next.default;
                if (previousDefault != null && change.options && !change.options.some((option) => JSON.stringify(option.value) === JSON.stringify(previousDefault))) next.default = null;
                onChange({ ...value, [editing.key]: next }); form.reset(values); setEditing(null);
            }}>
                <Field name="label" label={t("modelScripts.labelZh")} schema={z.string().trim().min(1)}><Input /></Field>
                <Field name="labelEn" label={t("modelScripts.labelEn")}><Input /></Field>
                <Field name="description" label={t("modelScripts.descriptionZh")}><Textarea /></Field>
                <Field name="descriptionEn" label={t("modelScripts.descriptionEn")}><Textarea /></Field>
                <Field name="hidden" label={t("modelScripts.hidden")} checked><Switch /></Field>
                <Field name="advanced" label={t("modelScripts.advanced")} checked><Switch /></Field>
                <Field name="required" label={t("modelScripts.required")} checked><Switch disabled={controls.find((control) => control.key === editing.key)?.required} /></Field>
                <Field name="order" label={t("modelScripts.order")}><NumberInput /></Field>
                {editing.type === "select" ? <Field name="options" label={t("modelScripts.allowedOptions")} schema={z.array(z.string()).min(1)}><Choice multiple options={controls.find((control) => control.key === editing.key)?.options?.map((option) => ({ label: inputLabel(option), value: JSON.stringify(option.value) }))} /></Field> : null}
                {editing.type === "number" ? <div className="grid grid-cols-2 gap-3"><Field name="min" label={t("modelScripts.min")}><NumberInput min={controls.find((control) => control.key === editing.key)?.min} /></Field><Field name="max" label={t("modelScripts.max")}><NumberInput max={controls.find((control) => control.key === editing.key)?.max} /></Field></div> : null}
            </EditorForm> : null}
        </Dialog>
    </div>;
}

export function ModelPricingFields({ value = {}, onChange }: { value: ModelPricing; onChange: (value: ModelPricing) => void }) {
    const { t } = useTranslation();
    const units = ["uncached_input_tokens", "cached_tokens", "output_tokens", "images", "seconds", "characters", "requests"];
    const rates = value.rates || {};
    const changeRate = (unit: string, key: "per" | "amount" | "points", next: string) => {
        const updated = { ...rates[unit], [key]: next === "" && key !== "per" ? undefined : next };
        onChange({ ...value, rates: { ...rates, [unit]: updated } });
    };
    return <div className="space-y-4"><p className="text-xs leading-5 text-muted-foreground">{t("modelScripts.pricingHint")}</p>
        <div className="grid grid-cols-2 gap-3"><label className="space-y-2 text-sm"><span>{t("modelScripts.currency")}</span><Input placeholder="CNY" value={value.currency || ""} onChange={(event) => onChange({ ...value, currency: event.target.value.toUpperCase() })} /></label><label className="space-y-2 text-sm"><span>{t("modelScripts.exchangeRate")}</span><Input inputMode="decimal" placeholder={t("modelScripts.unknown")} value={value.exchangeRate || ""} onChange={(event) => onChange({ ...value, exchangeRate: event.target.value || undefined })} /></label></div>
        {Object.entries(rates).map(([unit, rate]) => <div key={unit} className="grid items-end gap-3 rounded-lg border border-border p-3 sm:grid-cols-[minmax(0,1fr)_6rem_minmax(0,1fr)_minmax(0,1fr)_auto]">
            <span className="pb-2 text-sm">{t(`modelScripts.units.${unit}`, { defaultValue: unit })}</span>
            {(["per", "amount", "points"] as const).map((key) => <label key={key} className="space-y-1 text-xs"><span>{t(`modelScripts.${key}`)}</span><Input inputMode="decimal" value={rate[key] || ""} placeholder={key === "per" ? "1" : t("modelScripts.unknown")} onChange={(event) => changeRate(unit, key, event.target.value)} /></label>)}
            <Button variant="ghost" size="sm" onClick={() => { const next = { ...rates }; delete next[unit]; onChange({ ...value, rates: next }); }}>{t("common.delete")}</Button>
        </div>)}
        <Choice value={undefined} placeholder={t("modelScripts.addRate")} options={units.filter((unit) => !rates[unit]).map((unit) => ({ value: unit, label: t(`modelScripts.units.${unit}`) }))} onChange={(unit) => onChange({ ...value, currency: value.currency || "CNY", rates: { ...rates, [unit]: { per: "1" } } })} />
    </div>;
}
