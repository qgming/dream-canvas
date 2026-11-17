import { cloneElement, isValidElement, useEffect, useId, useRef, type ReactElement, type ReactNode } from "react";
import { Controller, FormProvider, useForm, useFormContext, useWatch, type UseFormReturn, type FieldValues } from "react-hook-form";
import type { z } from "zod";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useEditGuard } from "@/hooks/use-edit-guard";

export function useEditorForm<T extends FieldValues = FieldValues>() {
    return useForm<T>({ mode: "onTouched" });
}

export async function validateForm<T extends FieldValues>(form: UseFormReturn<T>) {
    if (!await form.trigger()) { requestAnimationFrame(() => { const first = Object.keys(form.formState.errors)[0]; if (first) form.setFocus(first as any); }); throw new Error(""); }
    return form.getValues();
}

export function EditorForm({ form: supplied, initialValues, onSubmit, children, className, id, disabled }: { form?: UseFormReturn<any>; initialValues?: FieldValues; onSubmit?: (values: any) => void | Promise<unknown>; children: ReactNode; className?: string; id?: string; disabled?: boolean }) {
    const own = useForm({ defaultValues: initialValues, mode: "onTouched" });
    const form = supplied || own;
    const submitting = useRef(false);
    useEditGuard(form.formState.isDirty, form.reset);
    useEffect(() => { form.reset(initialValues || form.getValues()); }, []);
    return <FormProvider {...form}><form id={id} noValidate onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (submitting.current) return;
        submitting.current = true;
        form.clearErrors("root");
        void form.handleSubmit(async (values) => { await onSubmit?.(values); })(event).catch((error: unknown) => { form.setError("root", { message: error instanceof Error ? error.message : String(error) }); }).finally(() => { submitting.current = false; });
    }}><fieldset disabled={disabled || form.formState.isSubmitting} className={cn("min-w-0 space-y-5 disabled:opacity-70", className)}>{children}{form.formState.errors.root?.message ? <p role="alert" className="text-sm text-destructive">{String(form.formState.errors.root.message)}</p> : null}</fieldset></form></FormProvider>;
}

export function Field({ name, label, description, children, schema, className, checked, validate, layout = "vertical" }: { name?: string; label?: ReactNode; description?: ReactNode; children: ReactNode; schema?: z.ZodTypeAny; className?: string; checked?: boolean; validate?: (value: any) => boolean | string; layout?: "vertical" | "horizontal" }) {
    const form = useFormContext();
    const { t } = useTranslation();
    const generatedId = useId();
    const id = `field-${name?.replace(/[^\w-]/g, "-") || "control"}-${generatedId}`;
    const required = Boolean(schema && !schema.isOptional());
    const render = (field?: { value: unknown; onChange: (...args: any[]) => void; onBlur: () => void; ref: (instance: unknown) => void }, error?: string) => {
        const labelElement = label ? <label htmlFor={id} className="block text-sm font-medium leading-5">{label}{required ? <span aria-hidden className="ml-1 text-destructive">*</span> : null}</label> : null;
        const descriptionElement = description ? <div id={`${id}-description`} className="text-xs leading-5 text-muted-foreground">{description}</div> : null;
        const control = isValidElement(children) ? cloneElement(children as ReactElement<Record<string, unknown>>, { id, ...(typeof label === "string" ? { "aria-label": label } : {}), "aria-describedby": [description ? `${id}-description` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined, ...(field ? { ref: field.ref, "aria-required": required || undefined, "aria-invalid": Boolean(error), [checked ? "checked" : "value"]: field.value ?? (checked ? false : ""), onBlur: field.onBlur, onChange: (...args: any[]) => { const next = args[0]; field.onChange(next?.target ? checked ? next.target.checked : next.target.value : next); (children.props as { onChange?: (...args: any[]) => void }).onChange?.(...args); } } : {}) }) : children;
        const errorElement = error ? <p id={`${id}-error`} role="alert" className="text-xs leading-5 text-destructive">{error}</p> : null;
        return layout === "horizontal" ? (
            <div className={cn("grid gap-2 py-3 @md/settings:grid-cols-[minmax(0,1fr)_minmax(0,18rem)] @md/settings:items-center @md/settings:gap-x-8", className)}>
                <div className="min-w-0 space-y-1">{labelElement}{descriptionElement}</div>
                <div className="min-w-0 space-y-2"><div className="flex min-w-0 items-center justify-end">{control}</div>{errorElement}</div>
            </div>
        ) : <div className={cn("space-y-2", className)}>{labelElement}{control}{errorElement}{descriptionElement}</div>;
    };
    return name && form ? <Controller name={name} control={form.control} rules={{ validate: async (value) => { if (validate) { const result = validate(value); if (result !== true) return result; } if (!schema) return true; const result = await schema.safeParseAsync(value ?? (required ? checked ? false : "" : undefined)); if (result.success) return true; const issue = result.error.issues[0]; return issue?.code === "invalid_type" ? t("ui.invalidValue") : issue?.message || t("ui.invalidValue"); } }} render={({ field, fieldState }) => render(field, fieldState.error?.message)} /> : render();
}

export { useWatch, useFormContext };
