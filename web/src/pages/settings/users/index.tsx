import { useTranslation } from "react-i18next";
import appI18n from "@/i18n";
import { PageHeader } from "@/components/layout/page-header";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Notice as Alert } from "@/components/ui/display";
import { useFeedback } from "@/hooks/use-feedback";
import { Button } from "@/components/ui/button";
import { EditorForm, Field } from "@/components/ui/form";
import { z } from "zod";
import { Input, PasswordInput } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { Choice } from "@/components/ui/choice";
import { Switch } from "@/components/ui/controls";
import { DataTable } from "@/components/ui/data-table";
import { Badge as Tag } from "@/components/ui/display";
import { Plus, RefreshCw } from "lucide-react";
import { useRef, useState } from "react";

import { createUser, listUsers, resetUserPassword, setUserDisabled, type User } from "@/services/api/auth";
import { useAuthStore } from "@/stores/use-auth-store";
import { captureSession } from "@/services/api/client";

export default function UsersPage() {
    useTranslation();
    const { notify } = useFeedback();
    const queryClient = useQueryClient();
    const current = useAuthStore((state) => state.user);
    const users = useQuery({ queryKey: ["admin-users"], queryFn: listUsers });
    const [creating, setCreating] = useState(false);
    const [resetting, setResetting] = useState<User | null>(null);
    const [busy, setBusy] = useState(false);
    const submitting = useRef(false);
    const run = async (action: () => Promise<unknown>, success: string) => {
        if (submitting.current) return false;
        submitting.current = true;
        const assertSession = captureSession();
        setBusy(true);
        try { await action(); assertSession(); await queryClient.invalidateQueries({ queryKey: ["admin-users"] }); assertSession(); notify.success(success); return true; }
        catch (error) { notify.error(error instanceof Error ? error.message : appI18n.t("workspace.operationFailed")); throw error; }
        finally { submitting.current = false; setBusy(false); }
    };
    return (
        <section className="space-y-6">
            <PageHeader title={<>{appI18n.t("workspace.users")}</>} actions={<><Button variant="outline" icon={<RefreshCw className="size-4" />} loading={users.isFetching} onClick={() => void users.refetch()}>{appI18n.t("workspace.refresh")}</Button><Button variant="default" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>{appI18n.t("workspace.createUser")}</Button></>} />
            {users.error ? <Alert type="error" title={users.error.message} action={<Button onClick={() => void users.refetch()}>{appI18n.t("workspace.retry")}</Button>} /> : null}
                <DataTable<User> rowId="id" loading={users.isLoading} failed={users.isError} rows={users.data} columns={[
                    { title: appI18n.t("workspace.username"), dataIndex: "username", render: (username) => <span className="font-medium break-words">{username}</span> },
                    { title: appI18n.t("workspace.role"), dataIndex: "role", render: (role) => <Tag>{role === "admin" ? appI18n.t("workspace.admin") : appI18n.t("workspace.user")}</Tag> },
                    { title: appI18n.t("workspace.status"), render: (_, user) => <Switch aria-label={`${user.username} · ${appI18n.t("workspace.enabled")}`} checked={!user.disabled} disabled={busy || user.id === current?.id} onChange={(enabled) => void run(() => setUserDisabled(user.id, !enabled), enabled ? appI18n.t("workspace.userEnabled") : appI18n.t("workspace.userDisabled")).catch(() => {})} /> },
                    { title: appI18n.t("workspace.createdAt"), dataIndex: "createdAt", render: (value: string) => <span className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">{new Date(value).toLocaleString(appI18n.resolvedLanguage)}</span> },
                    { title: appI18n.t("workspace.actions"), align: "right", render: (_, user) => <Button size="sm" variant="outline" disabled={busy} onClick={() => setResetting(user)}>{appI18n.t("workspace.resetPassword")}</Button> },
                ]} />
            <Dialog title={appI18n.t("workspace.createUser")} open={creating} busy={busy} onClose={() => setCreating(false)} bodyClassName="@container/settings" footer={<Button variant="default" type="submit" form="settings-create-user" loading={busy}>{appI18n.t("workspace.createUser")}</Button>}>
                <EditorForm id="settings-create-user" className="space-y-0" initialValues={{ role: "user" }} onSubmit={async (input) => { if (await run(() => createUser(input), appI18n.t("workspace.userCreated"))) setCreating(false); }}>
                    <Field layout="horizontal" name="username" label={appI18n.t("workspace.username")} schema={z.string().trim().min(1, appI18n.t("workspace.usernameRequired"))}><Input autoComplete="off" /></Field>
                    <Field layout="horizontal" name="password" label={appI18n.t("workspace.initialPassword")} schema={z.string().trim().min(1, appI18n.t("workspace.passwordRequired"))}><PasswordInput autoComplete="new-password" /></Field>
                    <Field layout="horizontal" name="role" label={appI18n.t("workspace.role")}><Choice options={[{ value: "user", label: appI18n.t("workspace.user") }, { value: "admin", label: appI18n.t("workspace.admin") }]} /></Field>
                </EditorForm>
            </Dialog>
            <Dialog title={appI18n.t("workspace.resetNamedPassword", { name: resetting?.username || "" })} open={Boolean(resetting)} busy={busy} onClose={() => setResetting(null)} bodyClassName="@container/settings" footer={<Button variant="default" type="submit" form="settings-reset-password" loading={busy}>{appI18n.t("workspace.resetPassword")}</Button>}>
                <EditorForm id="settings-reset-password" className="space-y-0" onSubmit={async ({ password }) => {
                    if (!resetting) return;
                    const self = resetting.id === current?.id;
                    if (await run(() => resetUserPassword(resetting.id, password), appI18n.t("workspace.passwordReset"))) { setResetting(null); if (self) useAuthStore.getState().clear(); }
                }}>
                    <Field layout="horizontal" name="password" label={appI18n.t("workspace.newPassword")} schema={z.string().trim().min(1, appI18n.t("workspace.passwordRequired"))}><PasswordInput autoComplete="new-password" /></Field>
                </EditorForm>
            </Dialog>
        </section>
    );
}
