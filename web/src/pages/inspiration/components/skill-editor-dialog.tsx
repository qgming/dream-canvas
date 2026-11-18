import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { Dialog } from "@/components/ui/dialog";
import { Disclosure } from "@/components/ui/tabs";
import { EditorForm, Field, useEditorForm, validateForm } from "@/components/ui/form";
import { Input, Textarea } from "@/components/ui/input";
import { useFeedback } from "@/hooks/use-feedback";
import { createAssistantSkill, updateAssistantSkill, type AgentSkillDetail, type AgentSkillDraft } from "@/services/api/assistant-skills";
import { useAgentSkillStore } from "@/stores/use-agent-skill-store";

export type SkillEditor = { detail?: AgentSkillDetail; draft?: AgentSkillDraft };
type SkillFormValues = { name: string; description: string; instructions: string; displayName: string; shortDescription: string; defaultPrompt: string };

export function SkillEditorDialog({ editor, onClose, onSaved }: { editor: SkillEditor; onClose: () => void; onSaved: () => void }) {
    const { t } = useTranslation();
    const { notify } = useFeedback();
    const form = useEditorForm<SkillFormValues>();
    const [advanced, setAdvanced] = useState(false);
    const { detail, draft } = editor;
    useEffect(() => {
        form.reset({ name: detail?.name || draft?.name || "", description: detail?.description || draft?.description || "", instructions: detail?.instructions || draft?.instructions || "", displayName: detail?.interface?.displayName || draft?.displayName || "", shortDescription: detail?.interface?.shortDescription || draft?.shortDescription || "", defaultPrompt: detail?.interface?.defaultPrompt || draft?.defaultPrompt || "" });
    }, [form, detail, draft]);

    const save = async () => {
        let values: SkillFormValues;
        try { values = await validateForm(form); }
        catch {
            const field = Object.keys(form.formState.errors)[0] as keyof SkillFormValues | undefined;
            if (field === "shortDescription" || field === "defaultPrompt") setAdvanced(true);
            if (field) requestAnimationFrame(() => form.setFocus(field));
            throw new Error("");
        }
        const name = detail?.name || values.name.trim();
        const defaultPrompt = values.defaultPrompt.trim();
        if (defaultPrompt && !new RegExp(`\\$${name}(?![A-Za-z0-9_-]|:[A-Za-z0-9_-])`).test(defaultPrompt)) {
            form.setError("defaultPrompt", { message: t("agent.skillManager.defaultPromptMention", { name }) });
            setAdvanced(true);
            requestAnimationFrame(() => form.setFocus("defaultPrompt"));
            throw new Error("");
        }
        const metadata = Object.fromEntries(Object.entries({ displayName: values.displayName.trim(), shortDescription: values.shortDescription.trim(), defaultPrompt }).filter(([, value]) => value));
        const input = { description: values.description.trim(), instructions: values.instructions.trim(), interface: metadata };
        if (detail) await updateAssistantSkill(name, { ...input, expectedRevision: detail.revision });
        else await createAssistantSkill({ name, ...input });
        form.reset(values);
        useAgentSkillStore.getState().setDraft(null);
        void useAgentSkillStore.getState().loadSkills();
        notify.success(t(detail ? "agent.skillManager.updated" : "agent.skillManager.created"));
        onSaved();
    };

    return <Dialog open title={detail ? t("agent.skillManager.editNamed", { name: detail.interface?.displayName || detail.name }) : t("agent.skillManager.createSkill")} description={t("workspace.skillsSaved")} onClose={onClose} onConfirm={save} width={720}>
        <EditorForm form={form}>
            <div className="grid gap-5 sm:grid-cols-2">
                <Field name="name" label={t("agent.skillManager.identifier")} description={t("agent.skillManager.identifierExtra")} schema={z.string().trim().min(1, t("agent.skillManager.identifierRequired")).max(64, t("agent.skillManager.identifierMax")).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, t("agent.skillManager.identifierPattern"))}><Input autoFocus disabled={Boolean(detail)} maxLength={64} placeholder={t("agent.skillManager.identifierPlaceholder")} /></Field>
                <Field name="displayName" label={t("agent.skillManager.displayName")} schema={z.string().max(64, t("agent.skillManager.displayNameMax")).optional()}><Input maxLength={64} placeholder={t("agent.skillManager.displayNamePlaceholder")} /></Field>
            </div>
            <Field name="description" label={t("agent.skillManager.whenToUse")} description={t("agent.skillManager.whenToUseExtra")} schema={z.string().trim().min(1, t("agent.skillManager.whenToUseRequired")).max(1024, t("agent.skillManager.whenToUseMax")).refine((value) => !/[<>]/.test(value), t("agent.skillManager.noAngleBrackets"))}><Textarea autoSize={{ minRows: 2, maxRows: 4 }} maxLength={1024} placeholder={t("agent.skillManager.whenToUsePlaceholder")} /></Field>
            <Field name="instructions" label={t("agent.skillManager.instructions")} description={t("agent.skillManager.instructionsExtra")} schema={z.string().trim().min(1, t("agent.skillManager.instructionsRequired"))}><Textarea autoSize={{ minRows: 8, maxRows: 14 }} className="leading-6" placeholder={t("agent.skillManager.instructionsPlaceholder")} /></Field>
            <Disclosure title={t("agent.skillManager.advanced")} open={advanced} onOpenChange={setAdvanced}>
                <div className="space-y-5">
                    <Field name="shortDescription" label={t("agent.skillManager.shortDescription")} description={t("agent.skillManager.shortDescriptionExtra")} schema={z.preprocess((value) => value === "" ? undefined : value, z.string().min(25, t("agent.skillManager.shortDescriptionMin")).max(64, t("agent.skillManager.shortDescriptionMax")).optional())}><Input maxLength={64} placeholder={t("agent.skillManager.shortDescriptionPlaceholder")} /></Field>
                    <Field name="defaultPrompt" label={t("agent.skillManager.defaultPrompt")} description={t("agent.skillManager.defaultPromptExtra")} schema={z.string().max(1024, t("agent.skillManager.defaultPromptMax")).optional()}><Textarea maxLength={1024} autoSize={{ minRows: 2, maxRows: 4 }} placeholder={t("agent.skillManager.defaultPromptPlaceholder")} /></Field>
                </div>
            </Disclosure>
        </EditorForm>
    </Dialog>;
}
