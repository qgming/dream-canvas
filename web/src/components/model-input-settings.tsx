import { useState } from "react";
import { Collapsible } from "@animate-ui/react/primitives/radix-ui";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/form";
import { Choice } from "@/components/ui/choice";
import { Input, NumberInput, Textarea } from "@/components/ui/input";
import { Switch } from "@/components/ui/controls";
import { Badge } from "@/components/ui/display";
import { ModelInputFields } from "@/components/model-parameters";
import type { ParameterControl, ParameterOverrides } from "@/services/api/channels";
import { applyInputOverrides, inputHelp, inputLabel } from "@/lib/model-inputs";

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
    return <div className="space-y-0 pb-3">
        <Field layout="horizontal" label={t("modelScripts.labelZh")}><Input value={effective.label} onChange={(event) => update({ label: event.target.value })} /></Field>
        <Field layout="horizontal" label={t("modelScripts.labelEn")}><Input value={effective.labelEn || ""} onChange={(event) => update({ labelEn: event.target.value })} /></Field>
        <Field layout="horizontal" label={t("modelScripts.descriptionZh")}><Textarea autoSize value={effective.description || ""} onChange={(event) => update({ description: event.target.value })} /></Field>
        <Field layout="horizontal" label={t("modelScripts.descriptionEn")}><Textarea autoSize value={effective.descriptionEn || ""} onChange={(event) => update({ descriptionEn: event.target.value })} /></Field>
        <Field layout="horizontal" label={t("modelScripts.order")}><NumberInput precision={0} value={effective.order ?? 0} onChange={(value) => update({ order: value ?? 0 })} /></Field>
        <Field layout="horizontal" label={t("modelScripts.hidden")}><Switch checked={effective.hidden} onChange={(hidden) => update({ hidden })} /></Field>
        <Field layout="horizontal" label={t("modelScripts.advanced")}><Switch checked={effective.advanced} onChange={(advanced) => update({ advanced })} /></Field>
        <Field layout="horizontal" label={t("modelScripts.required")}><Switch checked={effective.required} disabled={control.required} onChange={(required) => update({ required: control.required || required })} /></Field>
        {["select", "text", "textarea", "number"].includes(control.type) ? <Field layout="horizontal" label={t("modelScripts.allowedOptions")} help={control.type === "select" ? undefined : t("modelScripts.textOptionsHint")}><Choice multiple searchable={control.type !== "select"} creatable={!control.options?.length} value={(effective.options || []).map((option) => control.options?.length ? JSON.stringify(option.value) : String(option.value))} options={(control.options?.length ? control.options : control.suggestions)?.map((option) => ({ label: inputLabel(option), value: control.options?.length ? JSON.stringify(option.value) : String(option.value) }))} onChange={changeOptions} /></Field> : null}
        {control.type === "number" ? <><Field layout="horizontal" label={t("modelScripts.min")} schema={z.number().min(control.min ?? -Infinity, t("modelScripts.minOutsideScript")).nullable().optional()}><NumberInput value={effective.min ?? null} min={control.min ?? undefined} max={effective.max ?? undefined} step={control.step} onChange={(min) => update({ min: min ?? undefined })} /></Field><Field layout="horizontal" label={t("modelScripts.max")} schema={z.number().max(control.max ?? Infinity, t("modelScripts.maxOutsideScript")).nullable().optional()}><NumberInput value={effective.max ?? null} min={effective.min ?? undefined} max={control.max ?? undefined} step={control.step} onChange={(max) => update({ max: max ?? undefined })} /></Field></> : null}
        {current?.hidden && current.required && current.default == null ? <p role="alert" className="text-sm text-destructive">{t("ui.invalidValue")}</p> : null}
        {rootError ? <p role="alert" className="text-sm text-destructive">{rootError}</p> : null}
    </div>;
}

function ParameterRow({ control, base, override, onChange }: { control: ParameterControl; base: ParameterControl; override: ParameterOverrides[string] | undefined; onChange: (value: ParameterOverrides[string] | undefined) => void }) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const updateDefault = (value: unknown) => onChange({ ...override, default: value });
    const media = control.type === "reference" || control.type === "asset";
    const help = [`${t("modelScripts.key")}: ${control.key}`, inputHelp(control), media ? t("modelScripts.mediaScriptOwned") : ""].filter(Boolean).join("\n");
    return <Collapsible.Root open={open} onOpenChange={setOpen} className="px-3 py-1">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
            <Field layout="horizontal" className="min-w-0 flex-1 basis-80 py-0 @md/settings:grid-cols-[minmax(0,1fr)_minmax(0,16rem)] @md/settings:gap-x-4" label={<span className="inline-flex flex-wrap items-center gap-1.5"><span>{inputLabel(control)}</span>{control.required ? <Badge>{t("modelScripts.required")}</Badge> : null}{control.hidden ? <Badge>{t("modelScripts.hidden")}</Badge> : null}{control.advanced ? <Badge>{t("modelScripts.advanced")}</Badge> : null}</span>} help={help}>
                <div className="w-full min-w-0">{!media ? <ModelInputFields defaultsOnly controls={[{ ...control, hidden: false, advanced: false, when: undefined }]} value={{}} onChange={(values) => updateDefault(values[control.key])} hideLabels /> : null}</div>
            </Field>
            <div className="ml-auto flex flex-wrap items-center justify-end gap-2">{override ? <Button variant="outline" onClick={() => onChange(undefined)}>{t("modelScripts.resetField")}</Button> : null}<Collapsible.Trigger asChild><Button variant="outline">{t("modelScripts.fieldSettings")}</Button></Collapsible.Trigger></div>
        </div>
        <Collapsible.Content forceMount>
            <AdvancedOverrideEditor control={base} current={override} effective={control} onChange={onChange} />
        </Collapsible.Content>
    </Collapsible.Root>;
}

export function ModelInputSettings({ controls, value = {}, onChange }: { controls: ParameterControl[]; value: ParameterOverrides; onChange: (value: ParameterOverrides) => void }) {
    const { t } = useTranslation();
    const effective = applyInputOverrides(controls, value);
    const update = (key: string, next: ParameterOverrides[string] | undefined) => {
        const changes = { ...value };
        if (next) changes[key] = next; else delete changes[key];
        onChange(changes);
    };
    return <Field label={t("modelScripts.modelInputs")} help={t("modelScripts.overridesHint")}>
        {effective.length ? <div className="rounded-xl border border-border bg-card">{effective.map((control) => <ParameterRow key={control.key} control={control} base={controls.find((item) => item.key === control.key) || control} override={value[control.key]} onChange={(next) => update(control.key, next)} />)}</div> : <p className="py-3 text-sm text-muted-foreground">{t("modelScripts.noInputs")}</p>}
    </Field>;
}
