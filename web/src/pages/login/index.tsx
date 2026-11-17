import { useTranslation } from "react-i18next";
import appI18n from "@/i18n";
import { useQuery } from "@tanstack/react-query";
import { Notice as Alert } from "@/components/ui/display";
import { useFeedback } from "@/hooks/use-feedback";
import { Button } from "@/components/ui/button";
import { EditorForm, Field } from "@/components/ui/form";
import { z } from "zod";
import { Input, PasswordInput } from "@/components/ui/input";
import { useEffect, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";

import { getAuthStatus } from "@/services/api/auth";
import { useAuthStore } from "@/stores/use-auth-store";

export default function LoginPage() {
    useTranslation();
    const { notify } = useFeedback();
    const navigate = useNavigate();
    const location = useLocation();
    const user = useAuthStore((state) => state.user);
    const signIn = useAuthStore((state) => state.signIn);
    const refresh = useAuthStore((state) => state.refresh);
    const [busy, setBusy] = useState(false);
    const status = useQuery({ queryKey: ["auth-status"], queryFn: getAuthStatus });
    const from = (location.state as { from?: string } | null)?.from;
    const target = from?.startsWith("/") && !from.startsWith("//") && !from.startsWith("/login") ? from : "/canvas";
    useEffect(() => { void refresh(); }, [refresh]);
    if (user) return <Navigate to={target} replace />;

    const submit = async (values: { username: string; password: string }) => {
        setBusy(true);
        try { await signIn(values.username, values.password); navigate(target, { replace: true }); }
        catch (error) { notify.error(error instanceof Error ? error.message : appI18n.t("workspace.loginFailed")); throw error; }
        finally { setBusy(false); }
    };

    return (
        <main className="flex min-h-dvh items-center justify-center bg-background px-6 text-foreground">
            <div className="w-full max-w-sm py-12">
                <img src="/logo.svg" alt="" className="mb-8 size-9 dark:invert" />
                <h1 className="text-2xl font-medium tracking-tight">{appI18n.t("workspace.loginTitle")}</h1>
                <p className="mt-3 mb-8 text-sm text-muted-foreground">{appI18n.t("workspace.loginDescription")}</p>
                {status.error ? <Alert type="error" title={appI18n.t("workspace.serviceUnavailable")} description={appI18n.t("workspace.startService")} action={<Button onClick={() => void status.refetch()}>{appI18n.t("workspace.retry")}</Button>} className="mb-6" /> : null}
                {status.data?.initialized === false ? <Alert type="info" title={appI18n.t("workspace.initializeAdmin")} description={appI18n.t("workspace.initializeInstructions")} className="mb-6" /> : null}
                <EditorForm onSubmit={submit}>
                    <Field name="username" label={appI18n.t("workspace.username")} schema={z.string().trim().min(1, appI18n.t("workspace.usernameRequired"))}><Input autoComplete="username" autoFocus size="large" /></Field>
                    <Field name="password" label={appI18n.t("workspace.password")} schema={z.string().trim().min(1, appI18n.t("workspace.passwordRequired"))}><PasswordInput autoComplete="current-password" size="large" /></Field>
                    <Button variant="default" type="submit" size="lg" className="w-full" loading={busy} disabled={!status.data?.initialized}>{appI18n.t("workspace.login")}</Button>
                </EditorForm>
                <p className="mt-6 text-xs leading-6 text-muted-foreground">{appI18n.t("workspace.managedAccounts")}</p>
            </div>
        </main>
    );
}
