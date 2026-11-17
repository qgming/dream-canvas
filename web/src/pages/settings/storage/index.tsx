import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Notice, Badge } from "@/components/ui/display";
import { DataTable } from "@/components/ui/data-table";
import { Dialog } from "@/components/ui/dialog";
import { EditorForm, Field, useEditorForm, useWatch } from "@/components/ui/form";
import { Input, PasswordInput } from "@/components/ui/input";
import { Choice } from "@/components/ui/choice";
import { Switch } from "@/components/ui/controls";
import { useFeedback } from "@/hooks/use-feedback";
import { captureSession } from "@/services/api/client";
import { listStorages, saveStorage, deleteStorage, type StorageConfig } from "@/services/api/runtime";

const templates = [
    { provider: "r2", name: "Cloudflare R2", region: "auto", endpoint: "https://<ACCOUNT_ID>.r2.cloudflarestorage.com", pathStyle: true },
    { provider: "aliyun", name: "Alibaba Cloud OSS", region: "cn-hangzhou", endpoint: "https://oss-cn-hangzhou.aliyuncs.com", pathStyle: false },
    { provider: "tencent", name: "Tencent Cloud COS", region: "ap-guangzhou", endpoint: "https://cos.ap-guangzhou.myqcloud.com", pathStyle: false },
    { provider: "qiniu", name: "Qiniu Kodo", region: "cn-east-1", endpoint: "https://s3.cn-east-1.qiniucs.com", pathStyle: true },
    { provider: "s3", name: "S3", region: "us-east-1", endpoint: "https://s3.us-east-1.amazonaws.com", pathStyle: true },
];

export default function StoragePage() {
    const { t } = useTranslation();
    const { notify, confirm } = useFeedback();
    const query = useQuery({ queryKey: ["object-storages"], queryFn: listStorages });
    const form = useEditorForm();
    const provider = useWatch({ control: form.control, name: "provider" });
    const [editor, setEditor] = useState<{ record?: StorageConfig } | null>(null);
    const [busy, setBusy] = useState(false);
    const open = (record?: StorageConfig) => { form.reset(record ? { ...record, accessKeyId: "", accessKeySecret: "" } : { ...templates[0], default: !query.data?.some((row) => row.storage.default), bucket: "", accessKeyId: "", accessKeySecret: "" }); setEditor({ record }); };
    return <section className="space-y-6">
        <PageHeader title={t("storage.title")} description={t("storage.description")} actions={<Button onClick={() => open()}>{t("storage.add")}</Button>} />
        <Notice type="info" title={t("storage.singleActive")} description={t("storage.privateHint")} />
        {query.error ? <Notice type="error" title={query.error.message} action={<Button onClick={() => void query.refetch()}>{t("workspace.retry")}</Button>} /> : null}
        <DataTable<StorageConfig> rowId="id" rows={query.data?.map((row) => row.storage)} loading={query.isLoading} failed={query.isError} columns={[
            { title: t("workspace.name"), dataIndex: "name" },
            { title: t("storage.template"), render: (_, row) => t(`storage.providers.${row.provider}`) },
            { title: "Bucket", dataIndex: "bucket" },
            { title: t("workspace.status"), render: (_, row) => <Badge>{t(row.default ? "storage.active" : "storage.inactive")}</Badge> },
            { title: t("workspace.actions"), align: "right", render: (_, row) => <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => open(row)}>{t("workspace.edit")}</Button><Button variant="ghost" onClick={() => {
                const assertSession = captureSession();
                confirm({ title: t("storage.remove"), content: t("storage.removeHint"), destructive: true, onConfirm: async () => { assertSession(); await deleteStorage(row.id); assertSession(); await query.refetch(); } });
            }}>{t("storage.remove")}</Button></div> },
        ]} />
        <Dialog title={t(editor?.record ? "storage.edit" : "storage.add")} open={Boolean(editor)} busy={busy} onClose={() => setEditor(null)} bodyClassName="@container/settings" footer={<Button type="submit" form="storage-editor" loading={busy}>{t("workspace.save")}</Button>}>
            <EditorForm id="storage-editor" form={form} className="space-y-0" onSubmit={async (values) => {
                const assertSession = captureSession(); setBusy(true);
                try { await saveStorage(editor?.record?.id, { ...values, version: editor?.record?.version || 0, accessKeyId: values.accessKeyId?.trim() || undefined, accessKeySecret: values.accessKeySecret?.trim() || undefined }); assertSession(); form.reset(values); setEditor(null); await query.refetch(); notify.success(t("storage.saved")); }
                finally { setBusy(false); }
            }}>
                <Field layout="horizontal" name="provider" label={t("storage.template")}><Choice disabled={Boolean(editor?.record)} options={templates.map((item) => ({ value: item.provider, label: t(`storage.providers.${item.provider}`) }))} onChange={(provider) => { const template = templates.find((item) => item.provider === provider); if (template) for (const [key, value] of Object.entries(template)) form.setValue(key, value, { shouldDirty: true }); }} /></Field>
                <Field layout="horizontal" name="name" label={t("workspace.name")} schema={z.string().trim().min(1)}><Input /></Field>
                <Field layout="horizontal" name="endpoint" label="Endpoint" description={t("storage.endpointHint")} schema={z.string().url().refine((value) => value.startsWith("https://") && !value.includes("<"), t("storage.endpointRequired"))}><Input /></Field>
                <Field layout="horizontal" name="region" label={t("storage.region")} schema={z.string().trim().min(1)}><Input /></Field>
                <Field layout="horizontal" name="bucket" label="Bucket" description={t("storage.bucketHint")} schema={z.string().trim().min(1)}><Input /></Field>
                {provider !== "aliyun" && provider !== "tencent" ? <Field layout="horizontal" name="pathStyle" label={t("storage.pathStyle")} checked><Switch /></Field> : null}
                <Field layout="horizontal" name="accessKeyId" label="Access Key ID" schema={editor?.record ? z.string().optional() : z.string().trim().min(1)}><PasswordInput autoComplete="new-password" /></Field>
                <Field layout="horizontal" name="accessKeySecret" label="Secret Access Key" description={editor?.record ? t("workspace.credentialKeep") : t("workspace.credentialServer")} schema={editor?.record ? z.string().optional() : z.string().trim().min(1)}><PasswordInput autoComplete="new-password" /></Field>
                <Field layout="horizontal" name="default" label={t("storage.enable")} description={t("storage.singleActive")} checked><Switch /></Field>
            </EditorForm>
        </Dialog>
    </section>;
}
