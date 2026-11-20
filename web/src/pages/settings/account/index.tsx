import { useTranslation } from "react-i18next";
import appI18n from "@/i18n";
import { PageHeader } from "@/components/layout/page-header";
import { useFeedback } from "@/hooks/use-feedback";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/display";
import { EditorForm, Field, useEditorForm } from "@/components/ui/form";
import { z } from "zod";
import { PasswordInput } from "@/components/ui/input";
import { useState } from "react";
import { KeyRound } from "lucide-react";

import { changePassword } from "@/services/api/auth";
import { useAuthStore } from "@/stores/use-auth-store";
import { captureSession } from "@/services/api/client";

export default function AccountSettingsPage() {
    useTranslation();
    const { notify } = useFeedback();
    const user = useAuthStore((state) => state.user);
    const [saving, setSaving] = useState(false);
    const form = useEditorForm();
    const submit = async (values: { currentPassword: string; password: string }) => {
        const assertSession = captureSession();
        setSaving(true);
        try { await changePassword(values.currentPassword, values.password); assertSession(); notify.success(appI18n.t("workspace.passwordChanged")); useAuthStore.getState().clear(); }
        catch (error) { notify.error(error instanceof Error ? error.message : appI18n.t("workspace.changePasswordFailed")); throw error; }
        finally { setSaving(false); }
    };
    return (
        <section className="space-y-6">
            <PageHeader stickyActions title={appI18n.t("workspace.account")} description={appI18n.t("settings.accountDescription")} actions={<Button variant="default" icon={<KeyRound />} type="submit" form="account-password" disabled={!form.formState.isDirty} loading={saving}>{appI18n.t("workspace.changePassword")}</Button>} />
            <dl>
                <div className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                    <dt className="font-medium">{appI18n.t("workspace.username")}</dt>
                    <dd className="flex min-w-0 items-center gap-2"><span className="break-all">{user?.username}</span><Badge className="shrink-0">{user?.role === "admin" ? appI18n.t("workspace.admin") : appI18n.t("workspace.user")}</Badge></dd>
                </div>
            </dl>
            <section>
                <h2 className="mb-2 text-base font-semibold">{appI18n.t("workspace.changePassword")}</h2>
                <EditorForm id="account-password" form={form} onSubmit={submit} className="space-y-0">
                    <div>
                        <Field layout="horizontal" name="currentPassword" label={appI18n.t("workspace.currentPassword")} schema={z.string().trim().min(1, appI18n.t("workspace.currentPasswordRequired"))}><PasswordInput autoComplete="current-password" /></Field>
                        <Field layout="horizontal" name="password" label={appI18n.t("workspace.newPassword")} schema={z.string().trim().min(1, appI18n.t("workspace.newPasswordRequired"))}><PasswordInput autoComplete="new-password" /></Field>
                        <Field layout="horizontal" name="confirm" label={appI18n.t("workspace.confirmPassword")} schema={z.string().min(1, appI18n.t("workspace.confirmPasswordRequired"))} validate={(value) => value === form.getValues("password") || appI18n.t("workspace.passwordMismatch")}><PasswordInput autoComplete="new-password" /></Field>
                    </div>
                    <p className="border-t border-border pt-4 text-xs leading-5 text-muted-foreground">{appI18n.t("workspace.passwordSessions")}</p>
                </EditorForm>
            </section>
        </section>
    );
}
