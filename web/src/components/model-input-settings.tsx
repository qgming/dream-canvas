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
import type { ParameterControl, ParameterOverrides } from "@/services/api/channels";
import { applyInputOverrides, inputLabel } from "@/lib/model-inputs";

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
        {control.type === "number" ? <div className="grid grid-cols-2 gap-3"><Field label={t("modelScripts.min")} schema={z.number().min(control.min ?? -Infinity, t("modelScripts.minOutsideScript")).nullable().optional()}><NumberInput value={effective.min ?? null} min={control.min ?? undefined} max={effective.max ?? undefined} step={control.step} onChange={(min) => update({ min })} /></Field><Field label={t("modelScripts.max")} schema={z.number().max(control.max ?? Infinity, t("modelScripts.maxOutsideScript")).nullable().optional()}><NumberInput value={effective.max ?? null} min={effective.min ?? undefined} max={control.max ?? undefined} step={control.step} onChange={(max) => update({ max })} /></Field></div> : null}
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
            <div className="flex justify-end gap-2">{override ? <Button size="sm" variant="outline" onClick={() => onChange(undefined)}>{t("modelScripts.resetField")}</Button> : null}<Button size="sm" variant="outline" aria-expanded={open} onClick={() => setOpen((value) => !value)}>{t("modelScripts.fieldSettings")}</Button></div>
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
        {effective.length ? <div className="divide-y divide-border rounded-lg border border-border bg-card">{effective.map((control) => <ParameterRow key={control.key} control={control} base={controls.find((item) => item.key === control.key) || control} override={value[control.key]} onChange={(next) => update(control.key, next)} />)}</div> : <p className="text-sm text-muted-foreground">{t("modelScripts.noInputs")}</p>}
    </div>;
}
