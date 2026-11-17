import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EditorForm, Field, useEditorForm, useWatch } from "@/components/ui/form";
import { Input, NumberInput, Textarea } from "@/components/ui/input";
import { Switch } from "@/components/ui/controls";
import { Choice } from "@/components/ui/choice";
import { ModelInputFields } from "@/components/model-parameters";
import type { ParameterControl } from "@/services/api/channels";
import { inputLabel } from "@/lib/model-inputs";

const types: ParameterControl["type"][] = ["text", "textarea", "number", "switch", "select", "asset", "reference"];
const bounds = ["minCount", "maxCount", "maxBytes", "minWidth", "maxWidth", "minHeight", "maxHeight", "minDurationMs", "maxDurationMs"] as const;

export function InputDefinitionEditor({ value, onChange, readOnly, onEditorChange }: { value: ParameterControl[]; onChange: (value: ParameterControl[]) => void; readOnly?: boolean; onEditorChange?: (open: boolean) => void }) {
    const { t } = useTranslation();
    const form = useEditorForm();
    const [editor, setEditor] = useState<number | null>(null);
    useEffect(() => { onEditorChange?.(editor !== null); return () => onEditorChange?.(false); }, [editor, onEditorChange]);
    const type = useWatch({ control: form.control, name: "type" }) as ParameterControl["type"];
    const whenKey = useWatch({ control: form.control, name: "whenKey" });
    const options = useWatch({ control: form.control, name: "options" }) as ParameterControl["options"];
    const defaults = useWatch({ control: form.control, name: "defaultValue" });
    const optionType = useWatch({ control: form.control, name: "optionType" }) || "string";
    const open = (index: number) => { const field = value[index]; form.reset(field ? { ...field, defaultValue: field.default, whenKey: field.when?.key || "", whenValues: field.when?.values.map((item) => JSON.stringify(item)) || [], mimeTypes: field.mimeTypes?.join(", ") || "", optionType: field.options?.length ? typeof field.options[0].value : "string" } : { key: "", label: "", labelEn: "", type: "text", options: [], optionType: "string", whenKey: "", whenValues: [], required: false }); setEditor(index); };
    const source = value.find((control) => control.key === whenKey);
    const conditionOptions = source?.type === "switch" ? [true, false].map((item) => ({ label: t(item ? "modelScripts.true" : "modelScripts.false"), value: JSON.stringify(item) })) : source?.options?.map((option) => ({ label: inputLabel(option), value: JSON.stringify(option.value) }));
    return <div className="space-y-3">
        {!readOnly ? <Button size="sm" onClick={() => open(value.length)}>{t("modelScripts.addInput")}</Button> : null}
        {value.map((control, index) => <div key={index} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"><div className="min-w-0"><p className="truncate text-sm">{inputLabel(control)} <span className="font-mono text-xs text-muted-foreground">{control.key}</span></p><p className="text-xs text-muted-foreground">{t(`modelScripts.types.${control.type}`)}{control.when ? ` · ${control.when.key}` : ""}</p></div>{!readOnly ? <div className="flex gap-1"><Button variant="ghost" size="sm" onClick={() => open(index)}>{t("common.edit")}</Button><Button variant="ghost" size="sm" onClick={() => onChange(value.filter((_, row) => row !== index))}>{t("common.delete")}</Button></div> : null}</div>)}
        {!value.length ? <p className="text-sm text-muted-foreground">{t("modelScripts.noInputs")}</p> : null}
        <Dialog title={t("modelScripts.inputSettings")} open={editor !== null} onClose={() => setEditor(null)} width={720} footer={<Button type="submit" form="script-input">{t("common.save")}</Button>}>
            {editor !== null ? <EditorForm id="script-input" form={form} onSubmit={(values) => {
                const control: ParameterControl = { key: values.key.trim(), label: values.label.trim(), labelEn: values.labelEn, type: values.type, required: values.required, description: values.description, descriptionEn: values.descriptionEn, advanced: values.advanced, hidden: values.hidden, order: values.order || 0 };
                if (value.some((field, index) => index !== editor && field.key === control.key)) throw new Error(t("modelScripts.duplicateKey"));
                if (values.defaultValue != null && values.defaultValue !== "" && type !== "reference" && type !== "asset") control.default = values.defaultValue;
                if (type === "select") { if (!values.options?.length || values.options.some((option: any) => !option.label?.trim() || option.value === "" || option.value == null)) throw new Error(t("modelScripts.optionsRequired")); control.options = values.options; }
                if (type === "number") for (const key of ["min", "max", "step"] as const) if (values[key] != null) control[key] = values[key];
                if (type === "text" || type === "textarea") for (const key of ["minLength", "maxLength"] as const) if (values[key] != null) control[key] = values[key];
                if (type === "reference" || type === "asset") { control.role = values.role; control.transport = values.transport || "https"; control.mimeTypes = (values.mimeTypes || "").split(",").map((part: string) => part.trim()).filter(Boolean); for (const key of bounds) if (values[key] != null) control[key] = values[key]; }
                if (values.whenKey) { if (!values.whenValues?.length) throw new Error(t("modelScripts.conditionRequired")); control.when = { key: values.whenKey, values: values.whenValues.map((item: string) => JSON.parse(item)) }; }
                const next = [...value]; next[editor] = control; onChange(next); form.reset(values); setEditor(null);
            }}>
                <div className="grid gap-4 sm:grid-cols-2"><Field name="key" label={t("modelScripts.key")} schema={z.string().trim().min(1)}><Input /></Field><Field name="type" label={t("modelScripts.controlType")}><Choice options={types.map((item) => ({ value: item, label: t(`modelScripts.types.${item}`) }))} onChange={() => form.setValue("defaultValue", null, { shouldDirty: true })} /></Field><Field name="label" label={t("modelScripts.labelZh")} schema={z.string().trim().min(1)}><Input /></Field><Field name="labelEn" label={t("modelScripts.labelEn")}><Input /></Field></div>
                <div className="grid grid-cols-2 gap-4"><Field name="description" label={t("modelScripts.descriptionZh")}><Textarea /></Field><Field name="descriptionEn" label={t("modelScripts.descriptionEn")}><Textarea /></Field></div>
                <div className="flex flex-wrap gap-6"><Field name="required" label={t("modelScripts.required")} checked><Switch /></Field><Field name="advanced" label={t("modelScripts.advanced")} checked><Switch /></Field><Field name="hidden" label={t("modelScripts.hidden")} checked><Switch /></Field></div>
                {type === "select" ? <div className="space-y-3"><Field name="optionType" label={t("modelScripts.optionType")}><Choice options={["string", "number", "boolean"].map((item) => ({ value: item, label: t(`modelScripts.valueTypes.${item}`) }))} onChange={() => { form.setValue("options", [], { shouldDirty: true }); form.setValue("defaultValue", null, { shouldDirty: true }); }} /></Field>{(options || []).map((option, index) => <div key={index} className="grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-2"><Field name={`options.${index}.label`} label={t("modelScripts.labelZh")} schema={z.string().min(1)}><Input /></Field><Field name={`options.${index}.labelEn`} label={t("modelScripts.labelEn")}><Input /></Field><Field name={`options.${index}.value`} checked={optionType === "boolean"} label={t("modelScripts.value")}>{optionType === "number" ? <NumberInput /> : optionType === "boolean" ? <Switch checked={option.value === true} onChange={(next) => form.setValue(`options.${index}.value`, next, { shouldDirty: true })} /> : <Input />}</Field><Button variant="ghost" size="sm" onClick={() => form.setValue("options", options?.filter((_, row) => row !== index), { shouldDirty: true })}>{t("common.delete")}</Button></div>)}<Button size="sm" onClick={() => form.setValue("options", [...(options || []), { label: "", labelEn: "", value: optionType === "boolean" ? false : optionType === "number" ? 0 : "" }], { shouldDirty: true })}>{t("modelScripts.addOption")}</Button></div> : null}
                {type === "number" || type === "text" || type === "textarea" ? <div className="grid grid-cols-3 gap-3">{(type === "number" ? ["min", "max", "step"] : ["minLength", "maxLength"]).map((key) => <Field key={key} name={key} label={t(`modelScripts.${key}`)}><NumberInput /></Field>)}</div> : null}
                {type === "reference" || type === "asset" ? <><div className="grid grid-cols-2 gap-3"><Field name="role" label={t("modelScripts.mediaRole")} schema={z.enum(["image", "video", "audio"])}><Choice options={["image", "video", "audio"].map((item) => ({ value: item, label: t(`workspace.${item}`) }))} /></Field><Field name="transport" label={t("modelScripts.transport")}><Choice options={["https", "file", "data"].map((item) => ({ value: item, label: item }))} /></Field></div><Field name="mimeTypes" label={t("modelScripts.mimeTypes")}><Input placeholder="image/png, image/jpeg" /></Field><div className="grid grid-cols-3 gap-3">{bounds.map((key) => <Field key={key} name={key} label={t(`modelScripts.${key}`)}><NumberInput min={0} /></Field>)}</div></> : <div className="space-y-2"><p className="text-sm">{t("modelScripts.default")}</p><ModelInputFields controls={[{ key: "sample", label: t("modelScripts.default"), type: type || "text", options, advanced: false }]} value={{ sample: defaults }} onChange={(next) => form.setValue("defaultValue", next.sample, { shouldDirty: true })} /></div>}
                <Field name="whenKey" label={t("modelScripts.when")} description={t("modelScripts.whenHint")}><Choice clearable options={value.filter((field, index) => index !== editor && !field.when && (field.type === "select" || field.type === "switch")).map((field) => ({ value: field.key, label: inputLabel(field) }))} onChange={() => form.setValue("whenValues", [], { shouldDirty: true })} /></Field>
                {whenKey ? <Field name="whenValues" label={t("modelScripts.whenValues")}><Choice multiple options={conditionOptions} /></Field> : null}
                <Field name="order" label={t("modelScripts.order")}><NumberInput /></Field>
            </EditorForm> : null}
        </Dialog>
    </div>;
}
