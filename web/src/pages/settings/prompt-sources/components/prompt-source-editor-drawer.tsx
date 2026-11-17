import { EditorForm, Field, useEditorForm } from "@/components/ui/form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/controls";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import type { PromptSource } from "@/services/api/prompt-source-presets";

export function PromptSourceEditorDrawer({ open, source, onSave, onClose }: { open: boolean; source: PromptSource | null; onSave: (source: PromptSource) => void | Promise<unknown>; onClose: () => void }) {
    const { t } = useTranslation();
    const form = useEditorForm<PromptSource>();
    useEffect(() => { if (open && source) form.reset(source); }, [open, source, form]);
    const urlSchema = z.string().trim().url(t("config.promptSources.editor.invalidUrl")).refine((value) => isHttpUrl(value) && value.startsWith("https://"), t("workspace.httpsEndpoint"));
    const save = async (draft: PromptSource) => {
        await onSave({ ...draft, name: draft.name.trim(), url: draft.url.trim(), homepage: draft.homepage?.trim() || "", builtIn: false });
        form.reset(draft);
        onClose();
    };

    return (
        <Dialog
            open={open}
            width={560}
            title={t(source?.name ? "config.promptSources.editor.editTitle" : "config.promptSources.editor.addTitle")}
            onClose={onClose}
            bodyClassName="@container/settings"
            footer={<Button variant="default" type="submit" form="settings-prompt-source">{t("common.save")}</Button>}
        >
            <EditorForm id="settings-prompt-source" form={form} className="space-y-6" onSubmit={save}>
                <div>
                    <Field layout="horizontal" name="name" label={t("config.promptSources.editor.name")} schema={z.string().trim().min(1, t("config.promptSources.editor.nameRequired"))}>
                        <Input placeholder={t("config.promptSources.editor.namePlaceholder")} />
                    </Field>
                    <Field layout="horizontal" name="url" label="JSON URL" schema={urlSchema}>
                        <Input placeholder="https://example.com/prompts.json" />
                    </Field>
                    <Field layout="horizontal" name="homepage" label={t("config.promptSources.editor.homepage")} schema={z.string().refine((value) => !value.trim() || isHttpUrl(value.trim()), t("config.promptSources.editor.invalidHomepage")).optional()}>
                        <Input placeholder="https://example.com" />
                    </Field>
                    <Field layout="horizontal" name="enabled" checked label={t("config.promptSources.editor.enabled")}><Switch /></Field>
                </div>
                <div>
                    <div className="mb-2 text-sm font-medium">{t("config.promptSources.editor.jsonFormat")}</div>
                    <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs leading-5 text-muted-foreground  ">{`[
  {
    "id": "product-photo-1",
    "title": "Product photo",
    "prompt": "Generate a professional product photo on a white background",
    "description": "",
    "coverUrl": "",
    "referenceImageUrls": [],
    "tags": ["product", "photography"]
  }
]`}</pre>
                </div>
            </EditorForm>
        </Dialog>
    );
}

function isHttpUrl(value: string) {
    try {
        return ["http:", "https:"].includes(new URL(value).protocol);
    } catch {
        return false;
    }
}
