import { useTranslation } from "react-i18next";
import appI18n from "@/i18n";
import { PageHeader } from "@/components/layout/page-header";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Notice as Alert } from "@/components/ui/display";
import { useFeedback } from "@/hooks/use-feedback";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/controls";
import { EditorForm, Field } from "@/components/ui/form";
import { z } from "zod";
import { Input, Textarea } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { Choice } from "@/components/ui/choice";
import { DataTable } from "@/components/ui/data-table";
import { Badge as Tag } from "@/components/ui/display";
import { useState } from "react";

import { useCopyText } from "@/hooks/use-copy-text";
import { createToken, listTokens, revokeToken, type AccessToken } from "@/services/api/tokens";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { captureSession } from "@/services/api/client";


export default function AccessTokensPage() {
    useTranslation();
    const { notify, confirm } = useFeedback();

    const scopes = [{ value: "read", label: appI18n.t("workspace.read") }, { value: "edit", label: appI18n.t("workspace.edit") }, { value: "delete", label: appI18n.t("workspace.deleteScope") }];
    const queryClient = useQueryClient();
    const copy = useCopyText();
    const query = useQuery({ queryKey: ["access-tokens"], queryFn: listTokens });
    const projects = useCanvasStore((state) => state.projects);
    const [creating, setCreating] = useState(false);
    const [secret, setSecret] = useState("");
    const [busy, setBusy] = useState(false);
    const refresh = () => queryClient.invalidateQueries({ queryKey: ["access-tokens"] });
    const config = JSON.stringify({ mcpServers: { "dream-canvas": { url: `${window.location.origin}/mcp`, headers: { Authorization: `Bearer ${secret}` } } } }, null, 2);
    const confirmRevoke = (record: AccessToken) => {
        const assertSession = captureSession();
        confirm({ title: appI18n.t("workspace.revokeNamedToken", { name: record.name }), content: appI18n.t("workspace.revokeDescription"), confirmText: appI18n.t("workspace.revokeToken"), cancelText: appI18n.t("workspace.cancel"), onConfirm: async () => {
            try { assertSession(); await revokeToken(record.id); assertSession(); await refresh(); assertSession(); notify.success(appI18n.t("workspace.tokenRevoked")); }
            catch (error) { notify.error(error instanceof Error ? error.message : appI18n.t("workspace.revokeFailed")); throw error; }
        } });
    };
    return (
        <section className="space-y-6">
            <PageHeader title={appI18n.t("workspace.accessTokens")} description={appI18n.t("workspace.tokenDescription")} actions={<Button variant="default" onClick={() => setCreating(true)}>{appI18n.t("workspace.createToken")}</Button>} />
            {query.error ? <Alert type="error" title={query.error.message} action={<Button onClick={() => void query.refetch()}>{appI18n.t("workspace.retry")}</Button>} /> : null}
            <DataTable<AccessToken> rowId="id" rows={query.data} loading={query.isLoading} failed={query.isError} columns={[
                { title: appI18n.t("workspace.name"), dataIndex: "name", render: (name) => <span className="font-medium break-words">{name}</span> },
                { title: appI18n.t("workspace.permissions"), render: (_, record) => <div className="flex flex-wrap gap-1">{record.scopes.map((scope) => <Tag key={scope}>{scopes.find((item) => item.value === scope)?.label || scope}</Tag>)}</div> },
                { title: appI18n.t("workspace.projectScope"), render: (_, record) => <span className="break-words text-muted-foreground">{record.projects.length ? record.projects.map((id) => projects.find((project) => project.id === id)?.title || id).join("、") : appI18n.t("workspace.allProjects")}</span> },
                { title: appI18n.t("workspace.status"), render: (_, record) => <Tag color={record.revoked ? undefined : "success"}>{record.revoked ? appI18n.t("workspace.revoked") : appI18n.t("workspace.valid")}</Tag> },
                { title: appI18n.t("workspace.actions"), align: "right", render: (_, record) => <Button variant="ghost" size="sm" data-destructive disabled={record.revoked} onClick={() => confirmRevoke(record)}>{appI18n.t("workspace.revoke")}</Button> },
            ]} />
            <Dialog title={appI18n.t("workspace.createAccessToken")} open={creating} busy={busy} onClose={() => setCreating(false)} bodyClassName="@container/settings" footer={<Button variant="default" type="submit" form="settings-create-token" loading={busy}>{appI18n.t("workspace.createToken")}</Button>}>
                <EditorForm id="settings-create-token" className="space-y-0" initialValues={{ scopes: ["read"], projects: [] }} onSubmit={async (input) => {
                    const assertSession = captureSession();
                    setBusy(true);
                    try { const result = await createToken(input); assertSession(); setSecret(result.token); setCreating(false); await refresh(); }
                    catch (error) { notify.error(error instanceof Error ? error.message : appI18n.t("workspace.createFailed")); throw error; }
                    finally { setBusy(false); }
                }}>
                    <Field layout="horizontal" name="name" label={appI18n.t("workspace.name")} schema={z.string().trim().min(1, appI18n.t("workspace.nameRequired"))}><Input placeholder={appI18n.t("workspace.tokenNamePlaceholder")} /></Field>
                    <Field layout="horizontal" name="scopes" label={appI18n.t("workspace.operationPermissions")} schema={z.array(z.string()).min(1, appI18n.t("workspace.selectPermission"))}><Checkbox.Group className="w-full" options={scopes} /></Field>
                    <Field layout="horizontal" name="projects" label={appI18n.t("workspace.projectScope")} description={appI18n.t("workspace.projectScopeDescription")}><Choice multiple options={projects.map((project) => ({ value: project.id, label: project.title }))} placeholder={appI18n.t("workspace.allProjects")} /></Field>
                </EditorForm>
            </Dialog>
            <Dialog title={appI18n.t("workspace.saveAccessToken")} open={Boolean(secret)} onClose={() => setSecret("")} footer={<div className="flex flex-wrap items-center gap-2"><Button onClick={() => setSecret("")}>{appI18n.t("workspace.closeSaved")}</Button><Button variant="default" onClick={() => copy(config, appI18n.t("workspace.connectionCopied"))}>{appI18n.t("workspace.copyConnection")}</Button></div>}>
                <Alert type="warning" title={appI18n.t("workspace.tokenOnce")} description={appI18n.t("workspace.tokenOnceDescription")} className="mb-4" />
                <label htmlFor="settings-token-secret" className="mb-2 block text-sm font-medium">{appI18n.t("settings.accessTokens")}</label>
                <Textarea id="settings-token-secret" readOnly value={secret} autoSize spellCheck={false} className="mb-5 font-mono text-xs" />
                <label htmlFor="settings-token-config" className="mb-2 block text-sm font-medium">{appI18n.t("workspace.streamableConfig")}</label><Textarea id="settings-token-config" readOnly value={config} rows={10} spellCheck={false} className="font-mono text-xs" />
            </Dialog>
        </section>
    );
}
