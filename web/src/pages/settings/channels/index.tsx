import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Empty, Form, Input, Modal, Select, Space, Spin, Switch, Table, Tag } from "antd";
import { Plus, RefreshCw } from "lucide-react";
import { useState } from "react";

import { getInterface, listChannels, saveChannel, saveModel, type ChannelEntry, type ServerModel } from "@/services/api/channels";
import { InterfaceEditor } from "./components/interface-editor";
import { captureSession } from "@/services/api/client";

const protocols = [
    { value: "openai-chat", label: "OpenAI Chat Completions", capability: "text" },
    { value: "openai-responses", label: "OpenAI Responses", capability: "text" },
    { value: "openai-image", label: "OpenAI 图片生成 / 编辑", capability: "image" },
    { value: "seedance", label: "Seedance 官方视频", capability: "video" },
    { value: "minimax-video", label: "MiniMax 官方视频", capability: "video" },
    { value: "minimax-audio", label: "MiniMax 官方音频", capability: "audio" },
    { value: "custom", label: "自定义 JavaScript 接口", capability: "" },
];
const capabilityLabels = { text: "文本", image: "图片", video: "视频", audio: "音频" };

export default function ChannelsPage() {
    const { message } = App.useApp();
    const queryClient = useQueryClient();
    const query = useQuery({ queryKey: ["admin-channels"], queryFn: listChannels });
    const [channelEditor, setChannelEditor] = useState<{ entry?: ChannelEntry } | null>(null);
    const [modelEditor, setModelEditor] = useState<{ channelId: string; model?: ServerModel } | null>(null);
    const [scriptModel, setScriptModel] = useState<ServerModel | null>(null);
    const [busy, setBusy] = useState(false);
    const [channelForm] = Form.useForm();
    const [modelForm] = Form.useForm();
    const capability = Form.useWatch("capability", modelForm);
    const refresh = async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: ["admin-channels"] }), queryClient.invalidateQueries({ queryKey: ["model-catalog"] })]); };
    const failure = (error: unknown) => message.error(error instanceof Error ? error.message : "操作失败");
    const editChannel = (entry?: ChannelEntry) => {
        channelForm.resetFields();
        channelForm.setFieldsValue(entry ? { ...entry.channel, credential: "" } : { name: "", baseUrl: "", enabled: false });
        setChannelEditor({ entry });
    };
    const editModel = (channelId: string, model?: ServerModel) => {
        modelForm.resetFields();
        modelForm.setFieldsValue(model ? { ...model, parameters: JSON.stringify(model.parameters, null, 2), pricing: JSON.stringify(model.pricing, null, 2) } : { capability: "image", protocol: "openai-image", enabled: false, parameters: "[]", pricing: "{}" });
        setModelEditor({ channelId, model });
    };

    return (
        <section className="space-y-6">
            <header className="flex flex-wrap items-end justify-between gap-4">
                <div><h2 className="text-2xl font-medium tracking-tight">渠道与模型</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">统一配置渠道凭据、模型能力与接口版本。</p></div>
                <Space><Button type="text" icon={<RefreshCw className="size-4" />} loading={query.isFetching} onClick={() => void query.refetch()}>刷新</Button><Button type="primary" icon={<Plus className="size-4" />} onClick={() => editChannel()}>添加渠道</Button></Space>
            </header>
            <Alert type="info" title="当前可保存渠道、模型与接口版本" description="生成调度、供应商适配与脚本隔离执行仍在实施中。启用配置会更新模型目录，尚不能发起服务端生成。凭据不会返回浏览器。" />
            {query.error ? <Alert type="error" title={query.error.message} action={<Button onClick={() => void query.refetch()}>重试</Button>} /> : null}
            {query.isLoading ? <div role="status" className="flex min-h-48 items-center justify-center gap-3 text-sm text-muted-foreground"><Spin size="small" />正在读取渠道配置</div> : null}
            {query.data?.length === 0 ? <div className="rounded-2xl border border-dashed border-border py-12"><Empty description="还没有渠道，先添加一个渠道及其模型。"><Button type="primary" icon={<Plus className="size-4" />} onClick={() => editChannel()}>添加渠道</Button></Empty></div> : null}
            {query.data?.map((entry) => <section key={entry.channel.id} className="rounded-2xl border border-border bg-card p-5 text-card-foreground sm:p-6">
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                        <div><h3 className="text-lg font-medium">{entry.channel.name} <Tag>{entry.channel.enabled ? "启用" : "停用"}</Tag></h3><p className="mt-1 text-xs text-muted-foreground">{entry.channel.baseUrl} · {entry.hasCredential ? "已配置凭据" : "缺少凭据"}</p></div>
                        <Space><Button type="text" onClick={() => editChannel(entry)}>编辑渠道</Button><Button type="text" icon={<Plus className="size-4" />} onClick={() => editModel(entry.channel.id)}>添加模型</Button></Space>
                    </div>
                    <Table<ServerModel> rowKey="id" size="small" dataSource={entry.models} pagination={false} scroll={{ x: true }} columns={[
                        { title: "名称", dataIndex: "name" },
                        { title: "模型 ID", dataIndex: "model" },
                        { title: "类型", dataIndex: "capability", render: (value: ServerModel["capability"]) => capabilityLabels[value] },
                        { title: "协议", dataIndex: "protocol", render: (value) => protocols.find((item) => item.value === value)?.label || value },
                        { title: "状态", render: (_, model) => <Tag>{model.enabled ? "启用" : "停用"}</Tag> },
                        { title: "操作", render: (_, model) => <Space><Button type="text" size="small" onClick={() => editModel(entry.channel.id, model)}>编辑</Button>{model.protocol === "custom" ? <Button type="text" size="small" onClick={() => { void queryClient.prefetchQuery({ queryKey: ["interface", model.id], queryFn: () => getInterface(model.id) }); setScriptModel(model); }}>接口脚本</Button> : null}</Space> },
                    ]} />
            </section>)}
            <Modal title={channelEditor?.entry ? "编辑渠道" : "添加渠道"} open={Boolean(channelEditor)} onCancel={() => { channelForm.resetFields(); setChannelEditor(null); }} footer={null} destroyOnHidden>
                <Form form={channelForm} layout="vertical" requiredMark={false} onFinish={async (values) => {
                    const assertSession = captureSession();
                    setBusy(true);
                    try {
                        await saveChannel(channelEditor?.entry?.channel.id, { ...values, version: channelEditor?.entry?.channel.version || 0, credential: values.credential?.trim() || undefined });
                        assertSession(); channelForm.resetFields(); setChannelEditor(null); await refresh(); assertSession(); message.success("渠道已保存");
                    } catch (error) { failure(error); }
                    finally { setBusy(false); }
                }}>
                    <Form.Item name="name" label="渠道名称" rules={[{ required: true, whitespace: true, message: "请输入渠道名称" }]}><Input /></Form.Item>
                    <Form.Item name="baseUrl" label="HTTPS 接口地址" rules={[{ required: true, message: "请输入接口地址" }]}><Input placeholder="https://供应商接口地址" /></Form.Item>
                    <Form.Item name="credential" label="渠道凭据" extra={channelEditor?.entry ? "留空保留现有凭据。保存后不再回显。" : "凭据仅保存在服务器，保存后不再回显。"} rules={[{ required: !channelEditor?.entry, message: "请输入渠道凭据" }]}><Input.Password autoComplete="new-password" /></Form.Item>
                    <Form.Item name="enabled" label="启用渠道" valuePropName="checked"><Switch /></Form.Item>
                    <Button type="primary" htmlType="submit" loading={busy}>保存渠道</Button>
                </Form>
            </Modal>
            <Modal title={modelEditor?.model ? "编辑模型" : "添加模型"} open={Boolean(modelEditor)} onCancel={() => setModelEditor(null)} footer={null} width={720} destroyOnHidden>
                <Form form={modelForm} layout="vertical" requiredMark={false} onFinish={async (values) => {
                    if (!modelEditor) return;
                    const assertSession = captureSession();
                    setBusy(true);
                    try { await saveModel(modelEditor.channelId, modelEditor.model?.id, { ...values, parameters: JSON.parse(values.parameters), pricing: JSON.parse(values.pricing), version: modelEditor.model?.version || 0 }); assertSession(); setModelEditor(null); await refresh(); assertSession(); message.success("模型已保存"); }
                    catch (error) { failure(error); }
                    finally { setBusy(false); }
                }}>
                    <div className="grid gap-x-5 sm:grid-cols-2">
                        <Form.Item name="name" label="显示名称" rules={[{ required: true, whitespace: true, message: "请输入显示名称" }]}><Input /></Form.Item>
                        <Form.Item name="model" label="供应商模型 ID" rules={[{ required: true, whitespace: true, message: "请输入模型 ID" }]}><Input /></Form.Item>
                        <Form.Item name="capability" label="类型"><Select options={Object.entries(capabilityLabels).map(([value, label]) => ({ value, label }))} onChange={(value) => modelForm.setFieldValue("protocol", protocols.find((protocol) => protocol.capability === value)?.value || "custom")} /></Form.Item>
                        <Form.Item name="protocol" label="调用协议"><Select options={protocols.filter((protocol) => !protocol.capability || protocol.capability === capability)} /></Form.Item>
                    </div>
                    <Form.Item name="parameters" label="参数控件定义" extra={modelEditor?.model?.protocol === "custom" && modelEditor.model.publishedVersionId ? "当前为已发布接口的参数定义；修改请进入接口脚本，保存草稿后发布新版本。" : 'JSON 数组，例如 [{"key":"quality","label":"质量","type":"select","options":[{"label":"自动","value":"auto"}]}]。素材控件 type 为 asset，并配置 role：image、video 或 audio。'}><Input.TextArea rows={7} spellCheck={false} readOnly={modelEditor?.model?.protocol === "custom" && Boolean(modelEditor.model.publishedVersionId)} /></Form.Item>
                    <Form.Item name="pricing" label="价格定义草稿" extra="当前仅保存配置草稿，计量单位与整数精度规则随统计模块实施；空对象表示未配置，不表示零费用。"><Input.TextArea rows={3} spellCheck={false} /></Form.Item>
                    <Form.Item name="enabled" label="启用模型" valuePropName="checked"><Switch /></Form.Item>
                    <Button type="primary" htmlType="submit" loading={busy}>保存模型</Button>
                </Form>
            </Modal>
            {scriptModel ? <InterfaceEditor model={scriptModel} onClose={() => setScriptModel(null)} onPublished={async () => { await refresh(); setScriptModel(null); }} /> : null}
        </section>
    );
}
