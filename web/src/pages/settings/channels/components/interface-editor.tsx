import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Input, Modal, Space, Tabs, Tag } from "antd";
import CodeMirror from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { useState } from "react";

import { getInterface, publishInterface, saveInterface, type InterfaceDraft, type InterfaceScripts, type ServerModel } from "@/services/api/channels";
import { useThemeStore } from "@/stores/use-theme-store";
import { captureSession } from "@/services/api/client";

const labels: Record<keyof InterfaceScripts, string> = { submit: "提交", query: "查询", result: "结果解析", usage: "用量解析", cancel: "取消" };

export function InterfaceEditor({ model, onClose, onPublished }: { model: ServerModel; onClose: () => void; onPublished: () => Promise<void> }) {
    const { message, modal } = App.useApp();
    const queryClient = useQueryClient();
    const theme = useThemeStore((state) => state.theme);
    const query = useQuery({ queryKey: ["interface", model.id], queryFn: () => getInterface(model.id) });
    const [edited, setEdited] = useState<InterfaceDraft | null>(null);
    const [parameters, setParameters] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const draft = edited || query.data?.draft;
    const dirty = Boolean(edited || parameters !== null);
    const save = async () => {
        if (!draft) return;
        const assertSession = captureSession();
        setBusy(true);
        try {
            const saved = await saveInterface(model.id, { ...draft, parameters: parameters === null ? draft.parameters : JSON.parse(parameters) });
            assertSession();
            queryClient.setQueryData(["interface", model.id], { ...query.data, draft: saved });
            setEdited(null); setParameters(null); message.success("接口草稿已保存");
        } catch (error) { message.error(error instanceof Error ? error.message : "保存失败"); }
        finally { setBusy(false); }
    };
    const publish = () => {
        if (!draft) return;
        const assertSession = captureSession();
        modal.confirm({ title: "发布此接口版本？", content: "此版本尚未经真实调用验证。发布会保存不可变版本，后续任务使用提交时的版本。脚本隔离执行仍待实施，此操作不会调用供应商。", okText: "发布未验证版本", cancelText: "取消", onOk: async () => {
            try { assertSession(); await publishInterface(model.id, draft.revision, model.version); assertSession(); message.success("接口版本已发布，标记为未验证"); await onPublished(); }
            catch (error) { message.error(error instanceof Error ? error.message : "发布失败"); throw error; }
        } });
    };
    const close = () => dirty ? modal.confirm({ title: "放弃未保存的接口修改？", okText: "放弃修改", cancelText: "继续编辑", onOk: onClose }) : onClose();
    return (
        <Modal title={`${model.name} · 接口脚本`} open onCancel={close} width="min(1200px, calc(100vw - 32px))" style={{ top: 24 }} footer={<Space><Button onClick={close}>关闭</Button><Button onClick={() => void save()} disabled={!draft || !dirty} loading={busy}>保存草稿</Button><Button type="primary" disabled={!draft?.revision || dirty || busy} onClick={publish}>发布版本</Button></Space>}>
            <Alert type="info" title="保存草稿和发布版本均不会产生供应商费用" description="当前支持分入口编辑、版本检查和未验证发布。受控请求 API、隔离执行、真实调试及助手草稿工具仍待实施，脚本运行约定尚未定版。" className="mb-4" />
            {query.error ? <Alert type="error" title={query.error.message} action={<Button onClick={() => void query.refetch()}>重试</Button>} /> : null}
            {draft ? <Tabs items={[
                ...Object.entries(labels).map(([key, label]) => ({ key, label, children: <CodeMirror value={draft.scripts[key as keyof InterfaceScripts] || ""} height="420px" extensions={[javascript()]} theme={theme} onChange={(value) => setEdited({ ...draft, scripts: { ...draft.scripts, [key]: value } })} /> })),
                { key: "parameters", label: "参数控件", children: <Input.TextArea rows={18} spellCheck={false} value={parameters ?? JSON.stringify(draft.parameters, null, 2)} onChange={(event) => setParameters(event.target.value)} /> },
                { key: "versions", label: "已发布版本", children: <div className="space-y-3">{query.data?.versions.length ? query.data.versions.map((version) => <details key={version.id} className="rounded-lg border border-border p-3"><summary className="cursor-pointer text-sm">草稿版本 {version.draftRevision} · {new Date(version.createdAt).toLocaleString("zh-CN")} <Tag>{version.verified ? "已验证" : "未验证"}</Tag></summary><pre className="mt-3 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify({ scripts: version.scripts, parameters: version.parameters }, null, 2)}</pre></details>) : <p className="py-8 text-sm text-muted-foreground">尚未发布版本。</p>}</div> },
            ]} /> : null}
        </Modal>
    );
}
