import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { CircleHelp, Plus, Save, TestTube2 } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Notice, Badge } from "@/components/ui/display";
import { DataTable } from "@/components/ui/data-table";
import { Dialog } from "@/components/ui/dialog";
import { EditorForm, Field, useEditorForm, useWatch, validateForm } from "@/components/ui/form";
import { Input, PasswordInput } from "@/components/ui/input";
import { Choice } from "@/components/ui/choice";
import { Switch } from "@/components/ui/controls";
import { Tooltip } from "@/components/ui/popover";
import { useFeedback } from "@/hooks/use-feedback";
import { ApiError, captureSession } from "@/services/api/client";
import { listStorages, saveStorage, deleteStorage, testStorage, type StorageConfig, type StorageInput, type StorageTestResult } from "@/services/api/runtime";

const templates: (Pick<StorageConfig, "provider" | "region" | "endpoint" | "pathStyle"> & { keyLabel: string; secretLabel: string; bucketExample: string })[] = [
    { provider: "r2", region: "auto", endpoint: "https://<ACCOUNT_ID>.r2.cloudflarestorage.com", pathStyle: true, keyLabel: "Access Key ID", secretLabel: "Secret Access Key", bucketExample: "dream-canvas" },
    { provider: "aliyun", region: "cn-hangzhou", endpoint: "https://oss-cn-hangzhou.aliyuncs.com", pathStyle: false, keyLabel: "AccessKey ID", secretLabel: "AccessKey Secret", bucketExample: "dream-canvas" },
    { provider: "tencent", region: "ap-guangzhou", endpoint: "https://cos.ap-guangzhou.myqcloud.com", pathStyle: false, keyLabel: "SecretId", secretLabel: "SecretKey", bucketExample: "dream-canvas-1250000000" },
    { provider: "qiniu", region: "cn-east-1", endpoint: "https://s3.cn-east-1.qiniucs.com", pathStyle: true, keyLabel: "AccessKey", secretLabel: "SecretKey", bucketExample: "dream-canvas" },
    { provider: "s3", region: "us-east-1", endpoint: "https://s3.us-east-1.amazonaws.com", pathStyle: true, keyLabel: "Access Key ID", secretLabel: "Secret Access Key", bucketExample: "dream-canvas" },
];

export default function StoragePage() {
    const { t } = useTranslation();
    const { notify, confirm } = useFeedback();
    const query = useQuery({ queryKey: ["object-storages"], queryFn: listStorages });
    const form = useEditorForm<StorageInput>();
    const selectedProvider = useWatch({ control: form.control, name: "provider" });
    const template = templates.find((item) => item.provider === selectedProvider) || templates[0];
    const { provider } = template;
    const [editor, setEditor] = useState<{ record?: StorageConfig } | null>(null);
    const [busy, setBusy] = useState(false);
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState<StorageTestResult | null>(null);
    const [testError, setTestError] = useState("");
    const operation = useRef(false);
    useEffect(() => { const subscription = form.watch(() => { setTestResult((result) => result?.cleanupRequired ? result : null); setTestError(""); }); return () => subscription.unsubscribe(); }, [form]);
    const templateValues = ({ provider, region, endpoint, pathStyle }: typeof template) => ({ provider, name: t(`storage.providers.${provider}`), region, endpoint, pathStyle });
    const credentialHelp = `${t(`storage.providerHints.${provider}.credentials`)}\n${t(editor?.record ? "workspace.credentialKeep" : "workspace.credentialServer")}`;
    const storageInput = (values: StorageInput): StorageInput => ({ ...values, region: values.provider === "r2" ? "auto" : values.region, version: editor?.record?.version || 0, accessKeyId: values.accessKeyId?.trim() || undefined, accessKeySecret: values.accessKeySecret?.trim() || undefined });
    const failureText = (code?: string, status?: number) => t(status ? "storage.testHttpError" : `storage.testErrors.${code === "timeout" || code === "cancelled" || code === "private_address" || code === "content_mismatch" || code === "write_uncertain" ? code : "request_failed"}`, { status });
    const open = (record?: StorageConfig) => { form.reset(record ? { ...record, accessKeyId: "", accessKeySecret: "" } : { ...templateValues(templates[0]), default: !query.data?.some((row) => row.storage.default), bucket: "", accessKeyId: "", accessKeySecret: "" }); setTestResult(null); setTestError(""); setEditor({ record }); };
    const test = async () => {
        if (operation.current) return;
        operation.current = true; setTesting(true); setTestError(""); setTestResult(null);
        const assertSession = captureSession();
        try { const values = await validateForm(form); assertSession(); const result = await testStorage(editor?.record?.id, storageInput(values)); assertSession(); setTestResult(result); }
        catch (error) { setTestError(error instanceof ApiError && error.status === 404 && error.code === "request_failed" ? t("storage.testBackendRequired") : error instanceof Error ? error.message : t("ui.operationFailed")); }
        finally { operation.current = false; setTesting(false); }
    };
    return <section className="space-y-6">
        <PageHeader title={<span className="inline-flex items-center gap-2">{t("storage.title")}<Tooltip title={`${t("storage.singleActive")}\n${t("storage.privateHint")}`} clickable placement="right"><Button size="icon" variant="ghost" className="size-5 [&_svg]:size-3.5" aria-label={t("ui.parameterHelp", { name: t("storage.title") })}><CircleHelp aria-hidden="true" /></Button></Tooltip></span>} actions={<Button variant="default" icon={<Plus />} onClick={() => open()}>{t("storage.add")}</Button>} />
        {query.error ? <Notice type="error" title={query.error.message} action={<Button onClick={() => void query.refetch()}>{t("workspace.retry")}</Button>} /> : null}
        <DataTable<StorageConfig> rowId="id" rows={query.data?.map((row) => row.storage)} loading={query.isLoading} failed={query.isError} columns={[
            { title: t("workspace.name"), dataIndex: "name" },
            { title: t("storage.template"), render: (_, row) => t(`storage.providers.${row.provider}`) },
            { title: t("storage.bucket"), dataIndex: "bucket" },
            { title: t("workspace.status"), render: (_, row) => <Badge>{t(row.default ? "storage.active" : "storage.inactive")}</Badge> },
            { title: t("workspace.actions"), align: "right", render: (_, row) => <div className="flex justify-end gap-2"><Button variant="outline" size="sm" onClick={() => open(row)}>{t("workspace.edit")}</Button><Button variant="outline" size="sm" data-destructive onClick={() => {
                const assertSession = captureSession();
                confirm({ title: t("storage.remove"), content: t("storage.removeHint"), destructive: true, onConfirm: async () => { assertSession(); await deleteStorage(row.id); assertSession(); await query.refetch(); } });
            }}>{t("storage.remove")}</Button></div> },
        ]} />
        <Dialog title={t(editor?.record ? "storage.editProvider" : "storage.addProvider", { provider: t(`storage.providers.${provider}`) })} open={Boolean(editor)} busy={busy || testing} onClose={() => setEditor(null)} bodyClassName="@container/settings" secondaryAction={<Button icon={<TestTube2 />} loading={testing} title={t("storage.testHint")} onClick={() => void test()}>{t("storage.test")}</Button>} footer={<Button variant="default" icon={<Save />} type="submit" form="storage-editor" loading={busy}>{t("common.save")}</Button>}>
            <EditorForm id="storage-editor" form={form} className="space-y-0" onSubmit={async (values) => {
                if (operation.current) return;
                const assertSession = captureSession(); operation.current = true; setBusy(true);
                try { await saveStorage(editor?.record?.id, storageInput(values)); assertSession(); form.reset(values); setEditor(null); await query.refetch(); notify.success(t("storage.saved")); }
                finally { operation.current = false; setBusy(false); }
            }}>
                <Field layout="horizontal" name="provider" label={t("storage.template")} help={provider === "r2" ? `${t("storage.templateHint")}\n${t("storage.r2RegionHint")}` : t("storage.templateHint")}><Choice disabled={Boolean(editor?.record)} options={templates.map((item) => ({ value: item.provider, label: t(`storage.providers.${item.provider}`) }))} onChange={(provider) => { const next = templates.find((item) => item.provider === provider); if (next) { const values = templateValues(next); for (const key of ["provider", "name", "region", "endpoint", "pathStyle"] as const) form.setValue(key, values[key], { shouldDirty: true }); form.clearErrors(["endpoint", "region"]); } }} /></Field>
                <Field layout="horizontal" name="name" label={t("workspace.name")} schema={z.string().trim().min(1)}><Input /></Field>
                <Field layout="horizontal" name="endpoint" label={t("storage.endpoint")} help={`${t("storage.endpointHint")}\n${t(`storage.providerHints.${provider}.endpoint`)}`} schema={z.string().url().refine((value) => value.startsWith("https://") && !value.includes("<"), t("storage.endpointRequired"))}><Input placeholder={template.endpoint} /></Field>
                {provider !== "r2" ? <Field layout="horizontal" name="region" label={t("storage.region")} help={t("storage.regionHint", { region: template.region })} schema={z.string().trim().min(1)}><Input placeholder={template.region} /></Field> : null}
                <Field layout="horizontal" name="bucket" label={t(provider === "qiniu" ? "storage.qiniuBucket" : provider === "tencent" ? "storage.tencentBucket" : "storage.bucket")} help={t(`storage.providerHints.${provider}.bucket`)} schema={z.string().trim().min(1)}><Input placeholder={template.bucketExample} /></Field>
                {provider !== "aliyun" && provider !== "tencent" ? <Field layout="horizontal" name="pathStyle" label={t("storage.pathStyle")} help={t("storage.pathStyleHint")} checked><Switch /></Field> : null}
                <Field layout="horizontal" name="accessKeyId" label={template.keyLabel} help={credentialHelp} schema={editor?.record ? z.string().optional() : z.string().trim().min(1)}><PasswordInput autoComplete="new-password" /></Field>
                <Field layout="horizontal" name="accessKeySecret" label={template.secretLabel} help={credentialHelp} schema={editor?.record ? z.string().optional() : z.string().trim().min(1)}><PasswordInput autoComplete="new-password" /></Field>
                <Field layout="horizontal" name="default" label={t("storage.enable")} help={t("storage.singleActive")} checked><Switch /></Field>
            </EditorForm>
            {testResult ? <Notice className="my-3" type={testResult.success ? "success" : "error"} title={t(testResult.success ? "storage.testSuccess" : "storage.testFailed", { stage: t(`storage.testStages.${testResult.stage}`) })} description={<div className="space-y-1">
                <p>{testResult.success ? t("storage.testSnapshot") : failureText(testResult.code, testResult.httpStatus)}</p>
                {testResult.cleanupRequired ? <><p>{t("storage.testCleanupRequired", { key: testResult.objectKey })}</p>{testResult.versionId ? <p>{t("storage.testVersion", { version: testResult.versionId })}</p> : null}<p>{failureText(testResult.cleanupCode, testResult.cleanupHttpStatus)}</p></> : null}
            </div>} /> : null}
            {testError ? <Notice className="my-3" type="error" title={testError} /> : null}
        </Dialog>
    </section>;
}
