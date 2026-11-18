import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog } from "@/components/ui/dialog";
import { EditorForm, Field, useEditorForm, validateForm } from "@/components/ui/form";
import { Input, Textarea } from "@/components/ui/input";
import { Choice } from "@/components/ui/choice";
import { useFeedback } from "@/hooks/use-feedback";
import { createPrompt, updatePrompt, type Prompt, type PromptType } from "@/services/api/prompts";

type PromptFormValues = { title: string; description: string; prompt: string; type: PromptType; category: string };

export function PromptEditorDialog({ prompt, onClose, onSaved }: { prompt: Prompt | null; onClose: () => void; onSaved: (type: PromptType) => void }) {
    const { t } = useTranslation();
    const { notify } = useFeedback();
    const queryClient = useQueryClient();
    const form = useEditorForm<PromptFormValues>();
    useEffect(() => { form.reset({ title: prompt?.title || "", description: prompt?.description || "", prompt: prompt?.prompt || "", type: prompt?.type || "text", category: prompt?.category || "" }); }, [form, prompt]);

    const save = async () => {
        const values = await validateForm(form);
        const input = { ...values, title: values.title.trim(), prompt: values.prompt.trim(), version: prompt?.version || 0 };
        if (prompt) await updatePrompt(prompt.id, input);
        else await createPrompt(input);
        form.reset(values);
        void queryClient.invalidateQueries({ queryKey: ["prompts"] });
        notify.success(t("prompts.saved"));
        onSaved(values.type);
    };

    return <Dialog open title={t(prompt ? "prompts.edit" : "prompts.create")} description={t("prompts.personalDescription")} onClose={onClose} onConfirm={save} width={720}>
        <EditorForm form={form}>
            <Field name="title" label={t("prompts.name")} schema={z.string().trim().min(1, t("prompts.nameRequired"))}><Input autoFocus /></Field>
            <div className="grid gap-5 sm:grid-cols-2">
                <Field name="type" label={t("prompts.type")} schema={z.enum(["text", "image", "video"])}><Choice options={(["text", "image", "video"] as const).map((value) => ({ value, label: t(`prompts.types.${value}`) }))} /></Field>
                <Field name="category" label={t("prompts.category")} schema={z.string().optional()}><Input /></Field>
            </div>
            <Field name="description" label={t("prompts.description")} schema={z.string().optional()}><Textarea autoSize={{ minRows: 2, maxRows: 4 }} /></Field>
            <Field name="prompt" label={t("prompts.content")} schema={z.string().trim().min(1, t("prompts.contentRequired"))}><Textarea autoSize={{ minRows: 8, maxRows: 16 }} className="leading-6" /></Field>
        </EditorForm>
    </Dialog>;
}
