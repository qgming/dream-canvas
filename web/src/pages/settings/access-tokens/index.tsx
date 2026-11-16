import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Checkbox, Form, Input, Modal, Select, Space, Table, Tag } from "antd";
import { useState } from "react";

import { useCopyText } from "@/hooks/use-copy-text";
import { createToken, listTokens, revokeToken, type AccessToken } from "@/services/api/tokens";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { captureSession } from "@/services/api/client";

const scopes = [{ value: "read", label: "读取" }, { value: "edit", label: "编辑" }, { value: "delete", label: "申请及确认删除" }];

export default function AccessTokensPage() {
    const { message, modal } = App.useApp();
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
        modal.confirm({ title: `撤销「${record.name}」？`, content: "使用此令牌的客户端将无法继续访问。", okText: "撤销令牌", cancelText: "取消", onOk: async () => {
            try { assertSession(); await revokeToken(record.id); assertSession(); await refresh(); assertSession(); message.success("令牌已撤销"); }
            catch (error) { message.error(error instanceof Error ? error.message : "撤销失败"); throw error; }
        } });
    };
    return (
        <section>
            <header className="mb-5 flex flex-wrap items-center justify-between gap-4"><h2 className="text-2xl font-medium tracking-tight">访问令牌</h2><Button onClick={() => setCreating(true)}>创建令牌</Button></header>
            <p className="mb-5 text-sm leading-6 text-muted-foreground">支持 Bearer Token 的客户端可在浏览器关闭时读取和编辑项目。删除仍需明确确认。当前提供项目、资产元数据、模型目录与确认流程，生成和页面选区操作尚未开放。</p>
            {query.error ? <Alert type="error" title={query.error.message} action={<Button onClick={() => void query.refetch()}>重试</Button>} /> : null}
            <Table<AccessToken> rowKey="id" dataSource={query.data} loading={query.isLoading} pagination={false} scroll={{ x: true }} columns={[
                { title: "名称", dataIndex: "name" },
                { title: "权限", render: (_, record) => record.scopes.map((scope) => <Tag key={scope}>{scopes.find((item) => item.value === scope)?.label || scope}</Tag>) },
                { title: "项目范围", render: (_, record) => record.projects.length ? record.projects.map((id) => projects.find((project) => project.id === id)?.title || id).join("、") : "全部项目" },
                { title: "状态", render: (_, record) => record.revoked ? "已撤销" : "有效" },
                { title: "操作", render: (_, record) => <Button type="text" danger disabled={record.revoked} onClick={() => confirmRevoke(record)}>撤销</Button> },
            ]} />
            <Modal title="创建访问令牌" open={creating} onCancel={() => setCreating(false)} footer={null} destroyOnHidden>
                <Form layout="vertical" requiredMark={false} initialValues={{ scopes: ["read"], projects: [] }} onFinish={async (input) => {
                    const assertSession = captureSession();
                    setBusy(true);
                    try { const result = await createToken(input); assertSession(); setSecret(result.token); setCreating(false); await refresh(); }
                    catch (error) { message.error(error instanceof Error ? error.message : "创建失败"); }
                    finally { setBusy(false); }
                }}>
                    <Form.Item name="name" label="名称" rules={[{ required: true, whitespace: true, message: "请输入名称" }]}><Input placeholder="例如：桌面创作助手" /></Form.Item>
                    <Form.Item name="scopes" label="操作权限" rules={[{ type: "array", min: 1, required: true, message: "至少选择一项权限" }]}><Checkbox.Group options={scopes} /></Form.Item>
                    <Form.Item name="projects" label="项目范围" extra="留空表示全部项目；限定项目的令牌不能创建新项目或执行全局资产删除。"><Select mode="multiple" options={projects.map((project) => ({ value: project.id, label: project.title }))} placeholder="全部项目" /></Form.Item>
                    <Button type="primary" htmlType="submit" loading={busy}>创建令牌</Button>
                </Form>
            </Modal>
            <Modal title="保存访问令牌" open={Boolean(secret)} onCancel={() => setSecret("")} footer={<Space><Button onClick={() => setSecret("")}>已保存，关闭</Button><Button type="primary" onClick={() => copy(config, "接入配置已复制")}>复制接入配置</Button></Space>} destroyOnHidden>
                <Alert type="warning" title="此令牌只显示一次" description="服务器只保存哈希。关闭后无法再次查看，请妥善保存，不要粘贴到公开记录中。" className="mb-4" />
                <Input.TextArea readOnly value={secret} autoSize className="mb-4" />
                <p className="mb-2 text-sm">Streamable HTTP 接入配置</p><Input.TextArea readOnly value={config} rows={10} />
            </Modal>
        </section>
    );
}
